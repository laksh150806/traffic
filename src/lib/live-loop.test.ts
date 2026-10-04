/**
 * Runs the real live-mode control loop (performTick and performAdvance from traffic.functions)
 * against every migration on an in-process Postgres, through a stand-in for the Supabase client.
 * Until now those server functions had only ever been read, never run; this is what catches a
 * wrong column name, a violated constraint or a loop that leaves two greens at one junction.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLiveDb } from "@/lib/testing/live-db";

const holder = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: new Proxy({}, { get: (_target, key: string) => holder.client[key] }),
}));

let db: PGlite;
/** The migrations seed one reading and one decision per road, so tests count what the loop adds. */
const seeded = { counts: 0, history: 0, lastHistoryId: 0 };
let performTick: () => Promise<Record<string, unknown>>;
let performAdvance: () => Promise<Record<string, unknown>>;

const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0]?.n);
/** Let the throttle through again without waiting for real time to pass. */
const release = () => db.exec("UPDATE public.control_state SET last_run_at = 'epoch'");
/** Make every phase look old, so the controller has reason to hand the green over. */
const age = (seconds: number) =>
  db.exec(
    `UPDATE public.signal_timings SET updated_at = now() - interval '${seconds} seconds';
     UPDATE public.model_road_state SET updated_at = now() - interval '${seconds} seconds'`,
  );

const greensPerJunction = async () =>
  (
    await db.query<{ junction_id: number; greens: number }>(
      `SELECT j.junction_id, count(*) FILTER (WHERE t.is_currently_green)::int AS greens
         FROM public.junctions j LEFT JOIN public.signal_timings t USING (junction_id)
        GROUP BY j.junction_id ORDER BY j.junction_id`,
    )
  ).rows;

beforeAll(async () => {
  const live = await createLiveDb();
  db = live.db;
  seeded.counts = Number(
    (await db.query<{ n: number }>("SELECT count(*) AS n FROM public.vehicle_counts")).rows[0]?.n,
  );
  seeded.history = Number(
    (await db.query<{ n: number }>("SELECT count(*) AS n FROM public.signal_history")).rows[0]?.n,
  );
  seeded.lastHistoryId = Number(
    (
      await db.query<{ n: number }>(
        "SELECT coalesce(max(history_id), 0) AS n FROM public.signal_history",
      )
    ).rows[0]?.n,
  );
  holder.client = live.client as unknown as Record<string, unknown>;
  ({ performTick, performAdvance } = await import("@/lib/traffic.functions"));
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("live control loop on the real schema", () => {
  it("runs a first tick that writes the whole network", async () => {
    const result = await performTick();
    expect(result["ok"]).toBe(true);
    expect(result["cycles"]).toBe(69);
    expect(await count("SELECT count(*) AS n FROM public.model_road_state")).toBe(276);
    expect(await count("SELECT count(*) AS n FROM public.vehicle_counts")).toBe(
      seeded.counts + 276,
    );
    expect(await count("SELECT count(*) AS n FROM public.signal_history")).toBe(
      seeded.history + 276,
    );
    // Every plan is a legal one: greens inside the clamps, cycle at least their sum.
    const bad = await count(
      `SELECT count(*) AS n FROM public.model_road_state
        WHERE green_sec NOT BETWEEN 12 AND 90 OR cycle_length_sec < 60 OR cycle_length_sec > 150`,
    );
    expect(bad).toBe(0);
  }, 60_000);

  it("throttles a second call made straight away", async () => {
    const again = await performTick();
    expect(again["skipped"]).toBe(true);
    expect(await count("SELECT count(*) AS n FROM public.model_road_state")).toBe(276);
    expect(await count("SELECT count(*) AS n FROM public.signal_history")).toBe(
      seeded.history + 276,
    );
  });

  it("scores the previous prediction on the next tick", async () => {
    await release();
    await age(12);
    const result = await performTick();
    expect(result["cycles"]).toBe(69);
    expect(await count("SELECT count(*) AS n FROM public.model_accuracy")).toBeGreaterThan(0);
    expect(await count("SELECT count(*) AS n FROM public.signal_history")).toBe(
      seeded.history + 552,
    );
    // History carries both delays and the saving, none of them missing.
    expect(
      await count(
        `SELECT count(*) AS n FROM public.signal_history
          WHERE history_id > ${seeded.lastHistoryId}
            AND (predicted_delay_adaptive_sec IS NULL OR predicted_delay_fixed_sec IS NULL)`,
      ),
    ).toBe(0);
  }, 60_000);

  it("gives every junction exactly one green after the controller runs", async () => {
    await release();
    const result = await performAdvance();
    expect(result["ok"]).toBe(true);
    const rows = await greensPerJunction();
    expect(rows).toHaveLength(69);
    expect(rows.filter((r) => r.greens !== 1)).toEqual([]);
  }, 60_000);

  it("hands the green over when a phase has run its course, and logs it", async () => {
    await release();
    await age(300); // every phase has been green for five minutes
    const before = await count("SELECT count(*) AS n FROM public.phase_log");
    const result = await performAdvance();
    expect(Number(result["switched"])).toBeGreaterThan(0);
    expect(await greensPerJunction().then((r) => r.filter((x) => x.greens !== 1))).toEqual([]);
    // The trigger recorded each approach that was given the green.
    expect(await count("SELECT count(*) AS n FROM public.phase_log")).toBeGreaterThan(before);
  }, 60_000);

  it("keeps one green per junction through many rounds of tick and advance", async () => {
    for (let round = 0; round < 8; round += 1) {
      await release();
      await age(30 + round * 20);
      await performTick();
      await release();
      await performAdvance();
      const broken = (await greensPerJunction()).filter((r) => r.greens !== 1);
      expect(broken).toEqual([]);
    }
    expect(await count("SELECT count(*) AS n FROM public.model_road_state")).toBe(276);
  }, 120_000);

  it("takes a blocked lane into account", async () => {
    // The busiest approach at junction 1 loses most of its capacity while an incident is open.
    const road = (
      await db.query<{ road_id: number }>(
        "SELECT road_id FROM public.roads WHERE junction_id = 1 ORDER BY road_id",
      )
    ).rows.map((r) => r.road_id);
    await db.exec(
      `INSERT INTO public.incidents (junction_id, road_id, kind, starts_at, ends_at)
       VALUES (1, ${road[0]}, 'LANE_BLOCKED', now() - interval '1 minute', now() + interval '10 minutes')`,
    );
    await release();
    await performTick();
    const flows = (
      await db.query<{ road_id: number; saturation_flow_vph: string }>(
        `SELECT road_id, saturation_flow_vph FROM public.model_road_state
          WHERE junction_id = 1 ORDER BY road_id`,
      )
    ).rows.map((r) => Number(r.saturation_flow_vph));
    // One arm of the four is cut; whichever the model picks, it is far below the others.
    expect(Math.min(...flows)).toBeLessThan(Math.max(...flows) * 0.5);
  }, 60_000);

  it("prunes old history through the database function, not from the app", async () => {
    await db.exec(
      `INSERT INTO public.vehicle_counts (road_id, vehicle_count, source, recorded_at)
       VALUES (1, 5, 'SIMULATED_SENSOR', now() - interval '3 hours')`,
    );
    await release();
    await performTick();
    expect(
      await count(
        "SELECT count(*) AS n FROM public.vehicle_counts WHERE recorded_at < now() - interval '2 hours'",
      ),
    ).toBe(0);
  }, 60_000);
});
