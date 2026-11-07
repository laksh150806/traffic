import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const db = new PGlite();
await db.exec(
  `CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
   CREATE SCHEMA auth;
   CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
   GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
   GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;`,
);

let failures = 0;
const out = [];
const log = (ok, name, extra = "") => {
  if (!ok) failures += 1;
  out.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
};
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await rows(sql, params))[0];
const fails = async (sql, pattern) => {
  try {
    await db.exec(sql);
    return { failed: false };
  } catch (e) {
    return {
      failed: true,
      message: String(e.message),
      matches: pattern ? new RegExp(pattern, "i").test(String(e.message)) : true,
    };
  }
};

for (const f of files) {
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  if (!sql.trim()) continue;
  try {
    await db.exec(sql);
    log(true, `apply ${f.slice(0, 14)}`);
  } catch (e) {
    log(false, `apply ${f.slice(0, 14)}`, e.message);
    console.log(out.join("\n"));
    process.exit(1);
  }
}
// Second run of the new migration must be harmless.
{
  const last = fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8");
  try {
    await db.exec(last);
    log(true, "new migration is idempotent (second run)");
  } catch (e) {
    log(false, "new migration is idempotent (second run)", e.message);
  }
}

log((await one("SELECT count(*)::int n FROM junctions")).n === 69, "69 junctions");
log((await one("SELECT count(*)::int n FROM roads")).n === 276, "276 roads");
log((await one("SELECT count(*)::int n FROM signal_timings")).n === 276, "276 timings");
log(
  (await one("SELECT count(*)::int n FROM signal_timings WHERE is_currently_green")).n === 69,
  "one green per junction at seed",
);

// Seeds follow the id convention the app assumes: road = junctionIndex*4 + approach + 1 in N,S,E,W order.
{
  const r = await rows("SELECT road_id, junction_id, direction FROM roads ORDER BY road_id");
  const order = ["NORTH", "SOUTH", "EAST", "WEST"];
  const bad = r.filter(
    (x, i) => x.junction_id !== Math.floor(i / 4) + 1 || x.direction !== order[i % 4],
  );
  log(
    bad.length === 0,
    "road ids follow junction*4+approach order",
    bad[0] ? JSON.stringify(bad[0]) : "",
  );
}

// --- constraints
{
  const two = await fails(
    `UPDATE signal_timings SET is_currently_green = true WHERE junction_id = 1`,
    "unique|duplicate",
  );
  log(two.failed && two.matches, "two greens at one junction rejected", two.message?.slice(0, 80));
  const fk = await fails(
    `INSERT INTO signal_history (junction_id, road_id, allocated_green_sec) VALUES (2, 1, 20)`,
    "foreign key|violates",
  );
  log(
    fk.failed && fk.matches,
    "history row with the wrong junction rejected",
    fk.message?.slice(0, 80),
  );
  const dir2 = await fails(
    `INSERT INTO roads (junction_id, direction) VALUES (1, 'UP')`,
    "check|violates",
  );
  log(dir2.failed && dir2.matches, "bad direction rejected", dir2.message?.slice(0, 60));
  const neg = await fails(
    `INSERT INTO vehicle_counts (road_id, vehicle_count) VALUES (1, -3)`,
    "check|violates",
  );
  log(neg.failed && neg.matches, "negative vehicle count rejected");
  const green = await fails(
    `UPDATE signal_timings SET green_duration_sec = 500 WHERE road_id = 1`,
    "check|violates",
  );
  log(green.failed && green.matches, "absurd green time rejected");
  const lat = await fails(
    `INSERT INTO junctions (name, latitude, longitude) VALUES ('Nowhere', 200, 80)`,
    "check|violates",
  );
  log(lat.failed && lat.matches, "latitude out of range rejected");
  const dup = await fails(
    `INSERT INTO junctions (name, latitude, longitude) VALUES ('Tambaram Junction', 12.9, 80.1)`,
    "unique|duplicate",
  );
  log(dup.failed && dup.matches, "duplicate junction name rejected");
}

// --- generated column
{
  await db.exec(
    `INSERT INTO model_accuracy (road_id, junction_id, predicted_queue, actual_queue, baseline_queue) VALUES (1, 1, 10, 14, 12)`,
  );
  const r = await one(
    `SELECT abs_error::int e, baseline_queue b FROM model_accuracy ORDER BY accuracy_id DESC LIMIT 1`,
  );
  log(r.e === 4 && r.b === 12, "abs_error is computed by the database", JSON.stringify(r));
  const w = await fails(
    `INSERT INTO model_accuracy (road_id, junction_id, predicted_queue, actual_queue, abs_error) VALUES (1,1,1,1,9)`,
    "generated|cannot",
  );
  log(w.failed, "abs_error cannot be written directly");
}

// --- throttle
{
  const a = await one(`SELECT public.try_acquire_control('t1', 60000) AS ok`);
  const b = await one(`SELECT public.try_acquire_control('t1', 60000) AS ok`);
  const c = await one(`SELECT public.try_acquire_control('t2', 60000) AS ok`);
  const d = await one(`SELECT public.try_acquire_control('t1', 0) AS ok`);
  log(
    a.ok === true && b.ok === false && c.ok === true && d.ok === true,
    "throttle: first wins, second refused, other names independent, interval 0 passes",
    JSON.stringify([a.ok, b.ok, c.ok, d.ok]),
  );
}

// --- phase changes + trigger + safety
{
  const before = await rows(
    `SELECT road_id, is_currently_green g FROM signal_timings WHERE junction_id = 1 ORDER BY road_id`,
  );
  const cur = before.find((x) => x.g).road_id;
  const next = before.find((x) => !x.g).road_id;
  const r1 = await one(`SELECT public.apply_phase_changes($1::jsonb) AS n`, [
    JSON.stringify([{ end_road: cur, start_road: next, green: 25 }]),
  ]);
  const after = await rows(
    `SELECT road_id, is_currently_green g, green_duration_sec FROM signal_timings WHERE junction_id = 1 ORDER BY road_id`,
  );
  log(
    r1.n === 1 &&
      after.filter((x) => x.g).length === 1 &&
      after.find((x) => x.road_id === next).g &&
      after.find((x) => x.road_id === next).green_duration_sec === 25,
    "handover moves the green and sets its length",
    JSON.stringify(r1),
  );
  const log1 = await rows(
    `SELECT road_id, green_duration_sec FROM phase_log WHERE junction_id = 1`,
  );
  log(
    log1.length === 1 && log1[0].road_id === next,
    "trigger logged the new green",
    JSON.stringify(log1),
  );

  // Stale caller: believes `cur` is still green and tries to give the green to a third road.
  const third = before.find((x) => x.road_id !== cur && x.road_id !== next).road_id;
  const r2 = await one(`SELECT public.apply_phase_changes($1::jsonb) AS n`, [
    JSON.stringify([{ end_road: cur, start_road: third, green: 20 }]),
  ]);
  const after2 = await rows(
    `SELECT road_id FROM signal_timings WHERE junction_id = 1 AND is_currently_green`,
  );
  log(
    r2.n === 0 && after2.length === 1 && after2[0].road_id === next,
    "stale handover cannot create a second green",
    JSON.stringify({ r2, after2 }),
  );

  // A junction that fails must not stop the others.
  const j2 = await rows(
    `SELECT road_id, is_currently_green g FROM signal_timings WHERE junction_id = 2 ORDER BY road_id`,
  );
  const cur2 = j2.find((x) => x.g).road_id;
  const next2 = j2.find((x) => !x.g).road_id;
  const r3 = await one(`SELECT public.apply_phase_changes($1::jsonb) AS n`, [
    JSON.stringify([
      { end_road: cur, start_road: third, green: 20 },
      { end_road: cur2, start_road: next2, green: 18 },
    ]),
  ]);
  log(r3.n === 1, "one failing junction does not block the next", JSON.stringify(r3));

  const g = await one(`SELECT public.apply_green_allocations($1::jsonb) AS n`, [
    JSON.stringify([
      { road_id: 1, green: 41 },
      { road_id: 2, green: 33 },
    ]),
  ]);
  const keep = await one(
    `SELECT green_duration_sec g, is_currently_green c FROM signal_timings WHERE road_id = 1`,
  );
  log(
    g.n === 2 && keep.g === 41,
    "green allocations updated in one call",
    JSON.stringify({ g, keep }),
  );
  const same = await one(`SELECT public.apply_green_allocations($1::jsonb) AS n`, [
    JSON.stringify([{ road_id: 1, green: 41 }]),
  ]);
  log(same.n === 0, "unchanged allocation is not rewritten");
}

// --- incidents
{
  const ok = await fails(
    `INSERT INTO incidents (junction_id, road_id, ends_at) VALUES (1, 1, now() + interval '10 minutes')`,
  );
  log(!ok.failed, "valid incident accepted");
  const badWindow = await fails(
    `INSERT INTO incidents (junction_id, road_id, ends_at) VALUES (1, 1, now() - interval '1 minute')`,
    "check|violates",
  );
  log(badWindow.failed && badWindow.matches, "incident ending before it starts rejected");
  const wrongRoad = await fails(
    `INSERT INTO incidents (junction_id, road_id, ends_at) VALUES (2, 1, now() + interval '5 minutes')`,
    "foreign key|violates",
  );
  log(wrongRoad.failed && wrongRoad.matches, "incident on another junction's road rejected");
}

// --- views
{
  const v = await rows(`SELECT * FROM v_junction_congestion ORDER BY junction_id`);
  log(v.length === 69, "congestion view lists all junctions");
  log(
    ["LOW", "MODERATE", "HIGH"].includes(v[0].congestion_level),
    "congestion level present",
    v[0].congestion_level,
  );
  // one jammed arm must lift the level even when no model state exists yet
  await db.exec(`INSERT INTO vehicle_counts (road_id, vehicle_count) VALUES (5, 90)`);
  const lifted = await one(
    `SELECT congestion_level l, max_vehicle_count m FROM v_junction_congestion WHERE junction_id = 2`,
  );
  log(
    lifted.l === "HIGH" && lifted.m === 90,
    "one jammed arm makes the junction HIGH",
    JSON.stringify(lifted),
  );
  const latest = await one(`SELECT count(*)::int n FROM v_latest_vehicle_count`);
  log(latest.n === 276, "latest-count view has one row per road");
  await db.exec(
    `INSERT INTO signal_history (junction_id, road_id, allocated_green_sec, estimated_wait_saved_sec, cycle_number) VALUES (1,1,20,-30,5),(1,2,20,100,7),(2,5,20,10,3)`,
  );
  const saved = await one(`SELECT seconds::int s, window_min w FROM v_modelled_saving`);
  log(
    saved.s >= 80 && saved.w >= 1 && saved.w <= 60,
    "modelled saving view sums signed seconds over a window",
    JSON.stringify(saved),
  );
  const cyc = await one(`SELECT cycle_number::int c FROM v_junction_cycle WHERE junction_id = 1`);
  log(cyc.c === 7, "cycle view returns the latest cycle per junction", JSON.stringify(cyc));
}

// --- retention
{
  await db.exec(
    `INSERT INTO vehicle_counts (road_id, vehicle_count, recorded_at) VALUES (1, 3, now() - interval '3 hours')`,
  );
  await db.exec(
    `INSERT INTO phase_log (junction_id, road_id, green_duration_sec, started_at) VALUES (1, 1, 20, now() - interval '3 hours')`,
  );
  const r = await one(`SELECT public.prune_old_rows() AS j`);
  log(
    r.j.vehicle_counts >= 1 && r.j.phase_log >= 1,
    "retention removes old rows and reports counts",
    JSON.stringify(r.j),
  );
}

// --- who may call the control functions
{
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    const denied = await fails(
      `SELECT public.apply_phase_changes('[]'::jsonb)`,
      "permission denied",
    );
    await db.exec(`RESET ROLE`);
    log(
      denied.failed && denied.matches,
      `${role} cannot call apply_phase_changes`,
      denied.message?.slice(0, 60),
    );
  }
  await db.exec(`SET ROLE service_role`);
  const allowed = await fails(`SELECT public.apply_phase_changes('[]'::jsonb)`);
  await db.exec(`RESET ROLE`);
  log(!allowed.failed, "service_role can call apply_phase_changes");
  await db.exec(`SET ROLE anon`);
  const readOk = await fails(`SELECT count(*) FROM v_junction_congestion`);
  const writeBad = await fails(
    `UPDATE signal_timings SET green_duration_sec = 30`,
    "permission denied",
  );
  const ctl = await fails(`SELECT * FROM control_state`, "permission denied");
  await db.exec(`RESET ROLE`);
  log(!readOk.failed, "anon can read the congestion view");
  log(writeBad.failed && writeBad.matches, "anon cannot write signal timings");
  log(ctl.failed && ctl.matches, "anon cannot read the throttle table", ctl.message?.slice(0, 60));
}

// --- operator accounts, roles and row-level security
{
  const ADMIN = "00000000-0000-4000-8000-000000000001";
  const OPER = "00000000-0000-4000-8000-000000000002";
  const VIEW = "00000000-0000-4000-8000-000000000003";
  await db.exec(`INSERT INTO auth.users (id, email, created_at) VALUES
    ('${ADMIN}', 'chief@example.test', now() - interval '3 minutes'),
    ('${OPER}', 'desk@example.test', now() - interval '2 minutes'),
    ('${VIEW}', 'watch@example.test', now() - interval '1 minute')`);
  const roles = await rows(`SELECT user_id::text u, role FROM operator_profiles`);
  const roleOf = (u) => roles.find((r) => r.u === u)?.role;
  log(
    roleOf(ADMIN) === "admin" && roleOf(OPER) === "viewer" && roleOf(VIEW) === "viewer",
    "first sign-up is admin, later ones start as viewers",
    JSON.stringify(roles),
  );

  // Run SQL as a signed-in person: the authenticated role with their id in the JWT.
  const as = async (uid, sql, pattern) => {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
    const r = await fails(sql, pattern);
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false)`);
    return r;
  };
  const hold = (min) =>
    `INSERT INTO signal_holds (junction_id, road_id, reason, ends_at) VALUES (2, 5, 'ambulance on approach', now() + interval '${min} minutes')`;
  const incident = `INSERT INTO incidents (junction_id, road_id, kind, severity, ends_at) VALUES (2, 6, 'ACCIDENT', 3, now() + interval '30 minutes')`;

  const promoteByViewer = await as(VIEW, `SELECT set_operator_role('${OPER}', 'operator')`, "admin");
  log(promoteByViewer.failed && promoteByViewer.matches, "a viewer cannot change roles");
  const promote = await as(ADMIN, `SELECT set_operator_role('${OPER}', 'operator')`);
  log(!promote.failed, "an admin can promote someone to operator", promote.message);

  const viewerHold = await as(VIEW, hold(5), "row-level security");
  log(viewerHold.failed && viewerHold.matches, "a viewer cannot hold a signal", viewerHold.message?.slice(0, 70));
  const viewerIncident = await as(VIEW, incident, "row-level security");
  log(viewerIncident.failed && viewerIncident.matches, "a viewer cannot report an incident");
  const anonHold = await fails(`SET ROLE anon; ${hold(5)}`, "permission denied");
  await db.exec(`RESET ROLE`);
  log(anonHold.failed && anonHold.matches, "a signed-out visitor cannot hold a signal");

  const opHold = await as(OPER, hold(5));
  log(!opHold.failed, "an operator can hold a signal", opHold.message);
  const second = await as(OPER, hold(5), "already has a signal held");
  log(second.failed && second.matches, "a second live hold at the same junction is rejected");
  const tooLong = await as(OPER, hold(40).replace("(2, 5,", "(3, 9,"), "signal_holds_window_chk");
  log(tooLong.failed && tooLong.matches, "a hold longer than 15 minutes is rejected");
  const opIncident = await as(OPER, incident);
  log(!opIncident.failed, "an operator can report an incident", opIncident.message);
  const r1 = await one(`SELECT reported_by::text u, severity FROM incidents ORDER BY incident_id DESC LIMIT 1`);
  log(r1.u === OPER && r1.severity === 3, "the reporter is stamped by the database", JSON.stringify(r1));
  const forge = await as(
    OPER,
    `INSERT INTO incidents (junction_id, road_id, ends_at, reported_by) VALUES (2, 6, now() + interval '5 minutes', '${ADMIN}')`,
    "permission denied",
  );
  log(forge.failed && forge.matches, "an operator cannot sign an incident as someone else");

  const viewerEnd = await as(VIEW, `UPDATE incidents SET ends_at = now() WHERE ends_at > now()`);
  const stillOpen = await one(`SELECT count(*)::int n FROM incidents WHERE ends_at > now() AND reported_by IS NOT NULL`);
  log(!viewerEnd.failed && stillOpen.n === 1, "a viewer's update changes nothing (no rows visible to update)");
  const opDelete = await as(OPER, `DELETE FROM incidents WHERE reported_by IS NOT NULL`);
  const kept = await one(`SELECT count(*)::int n FROM incidents WHERE reported_by IS NOT NULL`);
  log(!opDelete.failed && kept.n === 1, "an operator cannot delete incidents");
  const opEnd = await as(
    OPER,
    `UPDATE incidents SET ends_at = now(), ended_by = '${OPER}' WHERE reported_by IS NOT NULL AND ends_at > now()`,
  );
  log(!opEnd.failed, "an operator can end an incident", opEnd.message);
  const adminDelete = await as(ADMIN, `DELETE FROM incidents WHERE reported_by IS NOT NULL`);
  const gone = await one(`SELECT count(*)::int n FROM incidents WHERE reported_by IS NOT NULL`);
  log(!adminDelete.failed && gone.n === 0, "an admin can delete an incident");

  const logged = await rows(`SELECT action FROM operator_actions ORDER BY action_id`);
  const actions = logged.map((r) => r.action).join(",");
  log(
    actions === "ROLE_CHANGED,SIGNAL_HELD,INCIDENT_REPORTED,INCIDENT_ENDED,INCIDENT_DELETED",
    "every operator write leaves one line in the log, in order",
    actions,
  );
  const forgeLog = await as(
    OPER,
    `INSERT INTO operator_actions (action) VALUES ('ROLE_CHANGED')`,
    "permission denied",
  );
  log(forgeLog.failed && forgeLog.matches, "nobody can write the log directly");
  const dispatch = await as(OPER, `SELECT log_dispatch(2, 'Rajiv Gandhi GH', 4)`);
  const viewerDispatch = await as(VIEW, `SELECT log_dispatch(2, 'x', 1)`, "operator");
  log(!dispatch.failed && viewerDispatch.failed, "only operators can log a dispatch");

  const lastAdmin = await as(ADMIN, `SELECT set_operator_role('${ADMIN}', 'viewer')`, "admin must remain");
  log(lastAdmin.failed && lastAdmin.matches, "the last admin cannot demote themselves");
  const selfPromote = await as(VIEW, `UPDATE operator_profiles SET role = 'admin' WHERE user_id = '${VIEW}'`, "permission denied");
  log(selfPromote.failed && selfPromote.matches, "nobody can edit their own role column");
  const rename = await as(VIEW, `UPDATE operator_profiles SET display_name = 'Night watch' WHERE user_id = '${VIEW}'`);
  log(!rename.failed, "people can rename themselves");

  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${OPER}', false)`);
  const board = await rows(`SELECT action, actor_name FROM v_operator_log ORDER BY action_id DESC LIMIT 1`);
  await db.exec(`RESET ROLE`);
  log(board[0]?.action === "AMBULANCE_DISPATCHED" && board[0]?.actor_name === "desk", "operator log view names the actor", JSON.stringify(board));
}

console.log(out.join("\n"));
console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
