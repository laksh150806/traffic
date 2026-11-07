import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { DistortButton, ElectricBorder, SlideCommit } from "@/components/fx/controls";
import { toast } from "@/components/fx/global";
import { Decrypt, RollNumber, TypeLine } from "@/components/fx/text";
import { Cubes, HudFrame, Lattice, LetterGlitch, StatusMark } from "@/components/fx/decor";
import { IncidentForm } from "@/components/shell/IncidentForm";
import {
  AUTH_AVAILABLE,
  canOperate,
  isAdmin,
  refreshAuth,
  useAuth,
  useNow,
  type Role,
} from "@/lib/auth";
import { DATA_MODE } from "@/lib/data-mode";
import {
  MissingMigrationError,
  deleteIncident,
  describeAction,
  endIncident,
  fetchActiveHolds,
  fetchCrew,
  fetchIncidentBoard,
  fetchOperatorLog,
  logDispatch,
  releaseHold,
  setRole,
  type BoardIncident,
} from "@/lib/ops-data";
import { HOSPITALS } from "@/lib/priority-run";
import { fetchJunctions, type JunctionSummary } from "@/lib/traffic-data";

export const Route = createFileRoute("/incidents")({
  head: () => ({ meta: [{ title: "Incidents & operations · SIGNAL OPS" }] }),
  component: IncidentsPage,
});

const SEV = ["", "MINOR", "MAJOR", "CRITICAL"];
const ist = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Junctions within ~700 m of the straight line from the start to the hospital: the corridor's signals. */
function corridorStops(
  from: JunctionSummary,
  to: { lat: number; lng: number },
  all: JunctionSummary[],
) {
  const ax = from.longitude;
  const ay = from.latitude;
  const bx = to.lng;
  const by = to.lat;
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-9;
  return all.filter((j) => {
    const t = Math.max(
      0,
      Math.min(1, ((j.longitude - ax) * (bx - ax) + (j.latitude - ay) * (by - ay)) / len2),
    );
    const d = Math.hypot(j.longitude - (ax + t * (bx - ax)), j.latitude - (ay + t * (by - ay)));
    return d < 0.0065;
  }).length;
}

function Migration({ error }: { error: unknown }) {
  if (!(error instanceof Error)) return null;
  return (
    <p
      role="alert"
      className={`ops-panel font-mono text-xs ${error instanceof MissingMigrationError ? "ops-amber" : "ops-red"}`}
    >
      {error.message}
    </p>
  );
}

function IncidentRow({
  inc,
  now,
  userId,
  canEdit,
  admin,
}: {
  inc: BoardIncident;
  now: number;
  userId: string | null;
  canEdit: boolean;
  admin: boolean;
}) {
  const queryClient = useQueryClient();
  const active = Date.parse(inc.ends_at) > now;
  const minsLeft = Math.max(0, Math.round((Date.parse(inc.ends_at) - now) / 60_000));
  const run = async (what: () => Promise<void>, done: string) => {
    try {
      await what();
      toast(done, "ok");
      void queryClient.invalidateQueries();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Refused", "bad");
    }
  };
  const body = (
    <div className={`ops-incident ${active ? "" : "is-closed"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={`ops-sev sev-${inc.severity}`}>{SEV[inc.severity] ?? inc.severity}</span>{" "}
          <span className="font-mono text-xs">{inc.kind.replace("_", " ")}</span>
          <h3 className="mt-1 text-sm font-semibold">
            <Link
              to="/junctions/$id"
              params={{ id: String(inc.junction_id) }}
              className="hover:text-[var(--amber)]"
            >
              {inc.junction_name ?? `J${inc.junction_id}`}
            </Link>{" "}
            <span className="ops-dim">· {inc.direction ?? "approach"}</span>
          </h3>
        </div>
        <div className="text-right font-mono text-xs">
          {active ? (
            <>
              <span className="ops-amber">{minsLeft} min left</span>
              <br />
              <span className="ops-dim">since {ist(inc.starts_at)}</span>
            </>
          ) : (
            <span className="ops-dim inline-flex items-center gap-1">
              <StatusMark ok className="!h-3.5 !w-3.5" /> cleared {ist(inc.ends_at)}
            </span>
          )}
        </div>
      </div>
      {inc.note ? <p className="mt-1 text-xs ops-dim">“{inc.note}”</p> : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="ops-label">
          by {inc.reported_by_name ?? "unknown"}
          {inc.ended_by_name ? ` · cleared by ${inc.ended_by_name}` : ""}
        </span>
        <span className="flex gap-1.5">
          {active && canEdit && userId ? (
            <button
              type="button"
              className="ops-btn"
              onClick={() =>
                void run(() => endIncident(inc.incident_id, userId), "Incident cleared.")
              }
            >
              Clear
            </button>
          ) : null}
          {admin ? (
            <DistortButton
              onClick={() => void run(() => deleteIncident(inc.incident_id), "Record deleted.")}
            >
              Delete
            </DistortButton>
          ) : null}
        </span>
      </div>
    </div>
  );
  return active && inc.severity >= 3 ? <ElectricBorder>{body}</ElectricBorder> : body;
}

function IncidentsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const now = useNow(15_000);
  const signedIn = auth.status === "signed-in";
  const userId = signedIn ? auth.operator.userId : null;
  const operate = canOperate(auth);
  const admin = isAdmin(auth);
  const live = DATA_MODE === "live";

  const board = useQuery({
    queryKey: ["incident-board"],
    queryFn: fetchIncidentBoard,
    enabled: live && signedIn,
    refetchInterval: 8000,
    retry: false,
  });
  const holds = useQuery({
    queryKey: ["holds"],
    queryFn: fetchActiveHolds,
    enabled: live && signedIn,
    refetchInterval: 5000,
    retry: false,
  });
  const log = useQuery({
    queryKey: ["operator-log", 60],
    queryFn: () => fetchOperatorLog(60),
    enabled: live && signedIn,
    refetchInterval: 6000,
    retry: false,
  });
  const crew = useQuery({
    queryKey: ["crew"],
    queryFn: fetchCrew,
    enabled: live && admin,
    retry: false,
  });
  const junctions = useQuery({
    queryKey: ["junctions"],
    queryFn: fetchJunctions,
    refetchInterval: 6000,
  });

  const [showClosed, setShowClosed] = useState(false);
  const incidents = (board.data ?? []).filter((i) => showClosed || Date.parse(i.ends_at) > now);
  const activeCount = (board.data ?? []).filter((i) => Date.parse(i.ends_at) > now).length;
  const critical = (board.data ?? []).filter(
    (i) => Date.parse(i.ends_at) > now && i.severity >= 3,
  ).length;
  const nameOf = (id: number) =>
    junctions.data?.find((j) => j.junction_id === id)?.name ?? `J${id}`;

  const [dispatchFrom, setDispatchFrom] = useState<number | null>(null);
  const [hospital, setHospital] = useState(HOSPITALS[0]?.id ?? "");
  const fromJ = junctions.data?.find(
    (j) => j.junction_id === (dispatchFrom ?? junctions.data?.[0]?.junction_id),
  );
  const hosp = HOSPITALS.find((h) => h.id === hospital);
  const stops = useMemo(
    () => (fromJ && hosp ? corridorStops(fromJ, hosp, junctions.data ?? []) : 0),
    [fromJ, hosp, junctions.data],
  );

  return (
    <div className="ops-page">
      <header className="ops-head">
        <div>
          <p className="ops-kicker">Field operations</p>
          <Decrypt as="h1" className="ops-h1" text="Incidents & operations" />
          <p className="ops-sub mt-2">
            Blocked approaches, manual signal holds, ambulance corridors and who did what. Every
            change is checked by the database against your role and written to the operator log.
          </p>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <span className="ops-label block">Active</span>
            <RollNumber value={activeCount} pad={2} className="ops-value ops-amber" />
          </div>
          <div className="text-right">
            <span className="ops-label block">Critical</span>
            <RollNumber value={critical} pad={2} className="ops-value ops-red" />
          </div>
          <Cubes className="hidden md:grid" />
        </div>
      </header>

      {!live ? (
        <p className="ops-panel ops-amber mb-4 font-mono text-xs">
          Simulated mode: incidents you log here cut capacity in the in-browser model only. The
          board, holds, log and crew need VITE_DATA_MODE=live with the roles migration run.
        </p>
      ) : !AUTH_AVAILABLE || auth.status === "signed-out" ? (
        <div className="ops-panel relative mb-4 overflow-hidden">
          <div className="absolute inset-0 opacity-40">
            <LetterGlitch />
          </div>
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-sm">
              Restricted board.{" "}
              <span className="ops-dim">Sign in to read incidents and the operator log.</span>
            </p>
            <Link to="/login" className="ops-btn solid">
              Sign in
            </Link>
          </div>
        </div>
      ) : auth.status === "no-roles" ? (
        <p className="ops-panel ops-amber mb-4 font-mono text-xs">
          Signed in as {auth.email}, but this database has no operator tables. Run
          supabase/migrations/20261107120000_operator_roles_and_rls.sql in the Supabase SQL editor,
          then reload.
        </p>
      ) : null}

      <div className="ops-grid xl:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <HudFrame label="Incident board" code={showClosed ? "ALL" : "ACTIVE"}>
            <div className="mb-3 flex justify-end">
              <label className="ops-label inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={showClosed}
                  onChange={(e) => setShowClosed(e.target.checked)}
                />
                Show cleared
              </label>
            </div>
            <Migration error={board.error} />
            {board.isLoading ? (
              <Lattice label="Loading incidents" />
            ) : incidents.length === 0 && signedIn && !board.isError ? (
              <p className="ops-label py-6 text-center">Board clear. No active incidents.</p>
            ) : (
              <ul className="space-y-2">
                {incidents.map((inc) => (
                  <li key={inc.incident_id}>
                    <IncidentRow
                      inc={inc}
                      now={now}
                      userId={userId}
                      canEdit={operate}
                      admin={admin}
                    />
                  </li>
                ))}
              </ul>
            )}
          </HudFrame>

          <HudFrame label="Operator log" code="AUDIT">
            <Migration error={log.error} />
            <div className="ops-term" role="log" aria-label="Operator log">
              {(log.data ?? []).length === 0 ? (
                <span className="ops-dim">
                  {signedIn ? "> no actions logged yet" : "> sign in to read the log"}
                  <span className="fx-caret" aria-hidden />
                </span>
              ) : (
                (log.data ?? []).map((e, i) => (
                  <div key={e.action_id}>
                    <span className="t">[{ist(e.at)}]</span>{" "}
                    <span className="who">{e.actor_name ?? "system"}</span>
                    {e.actor_role ? <span className="ops-dim">/{e.actor_role}</span> : null}{" "}
                    {i < 3 ? <TypeLine text={describeAction(e)} /> : describeAction(e)}
                  </div>
                ))
              )}
            </div>
          </HudFrame>
        </div>

        <div className="space-y-3">
          <HudFrame label="Log incident" code="FIELD">
            <IncidentForm />
          </HudFrame>

          <HudFrame label="Signal holds" code={`${holds.data?.length ?? 0} ACTIVE`}>
            <Migration error={holds.error} />
            {(holds.data ?? []).length === 0 ? (
              <p className="ops-label">No manual holds. Hold a green from a junction page.</p>
            ) : (
              <ul className="space-y-2">
                {(holds.data ?? []).map((h) => (
                  <li
                    key={h.hold_id}
                    className="flex items-center justify-between gap-2 font-mono text-xs"
                  >
                    <span>
                      <Link
                        to="/junctions/$id"
                        params={{ id: String(h.junction_id) }}
                        className="ops-amber hover:underline"
                      >
                        {nameOf(h.junction_id)}
                      </Link>
                      <span className="ops-dim">
                        {" "}
                        until {ist(h.ends_at)} · {h.reason}
                      </span>
                    </span>
                    {operate && userId ? (
                      <button
                        type="button"
                        className="ops-btn"
                        onClick={() =>
                          void releaseHold(h.hold_id, userId)
                            .then(() => {
                              toast("Hold released.", "info");
                              void queryClient.invalidateQueries();
                            })
                            .catch((e: unknown) =>
                              toast(e instanceof Error ? e.message : "Refused", "bad"),
                            )
                        }
                      >
                        Release
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </HudFrame>

          <HudFrame label="Ambulance corridor" code="PRIORITY">
            <div className="space-y-3">
              <label className="ops-field block">
                <span className="ops-label">Pickup junction</span>
                <select
                  className="ops-select mt-1"
                  value={fromJ?.junction_id ?? ""}
                  onChange={(e) => setDispatchFrom(Number(e.target.value))}
                >
                  {(junctions.data ?? []).map((j) => (
                    <option key={j.junction_id} value={j.junction_id}>
                      {j.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ops-field block">
                <span className="ops-label">Hospital</span>
                <select
                  className="ops-select mt-1"
                  value={hospital}
                  onChange={(e) => setHospital(e.target.value)}
                >
                  {HOSPITALS.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="ops-label">
                {stops} signalised junction{stops === 1 ? "" : "s"} near the straight-line corridor.
              </p>
              <SlideCommit
                label="Slide to log dispatch"
                disabled={!live || !operate || !fromJ || !hosp}
                onCommit={() => {
                  if (!fromJ || !hosp) return;
                  void logDispatch(fromJ.junction_id, hosp.name, stops)
                    .then(() => {
                      toast(`Corridor logged: ${fromJ.name} to ${hosp.name}.`, "ok");
                      void queryClient.invalidateQueries({ queryKey: ["operator-log"] });
                    })
                    .catch((e: unknown) =>
                      toast(e instanceof Error ? e.message : "Refused", "bad"),
                    );
                }}
              />
              <p className="ops-label">
                Logs the dispatch for the audit trail. The live green-wave run is on the Control
                room&apos;s Rescue branch (simulated mode).
              </p>
            </div>
          </HudFrame>

          {admin ? (
            <HudFrame label="Crew & roles" code="ADMIN">
              <Migration error={crew.error} />
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Operator</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {(crew.data ?? []).map((c) => (
                    <tr key={c.user_id}>
                      <td>{c.display_name}</td>
                      <td>
                        <select
                          className="ops-select"
                          value={c.role}
                          disabled={c.user_id === userId}
                          aria-label={`Role for ${c.display_name}`}
                          onChange={(e) =>
                            void setRole(c.user_id, e.target.value as Role)
                              .then(() => {
                                toast(`${c.display_name} is now ${e.target.value}.`, "ok");
                                void queryClient.invalidateQueries({ queryKey: ["crew"] });
                                void refreshAuth();
                              })
                              .catch((err: unknown) =>
                                toast(err instanceof Error ? err.message : "Refused", "bad"),
                              )
                          }
                        >
                          <option value="admin">admin</option>
                          <option value="operator">operator</option>
                          <option value="viewer">viewer</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="ops-label mt-2">
                New sign-ups start as viewers. You cannot change your own role.
              </p>
            </HudFrame>
          ) : null}
        </div>
      </div>
    </div>
  );
}
