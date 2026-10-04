/**
 * The other half of live mode: what the dashboard reads. Runs the control loop on the real schema,
 * then calls every fetch function in live mode and checks what comes back is complete and sane.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLiveDb } from "@/lib/testing/live-db";

const holder = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
const proxy = () => new Proxy({}, { get: (_target, key: string) => holder.client[key] });
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: proxy() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: proxy() }));

let db: PGlite;
let data: typeof import("@/lib/traffic-data");

beforeAll(async () => {
  vi.stubEnv("VITE_DATA_MODE", "live");
  const live = await createLiveDb();
  db = live.db;
  holder.client = live.client as unknown as Record<string, unknown>;
  const { performTick, performAdvance } = await import("@/lib/traffic.functions");
  for (let round = 0; round < 3; round += 1) {
    await db.exec("UPDATE public.control_state SET last_run_at = 'epoch'");
    await db.exec(
      `UPDATE public.signal_timings SET updated_at = now() - interval '200 seconds';
       UPDATE public.model_road_state SET updated_at = now() - interval '12 seconds'`,
    );
    await performTick();
    await db.exec("UPDATE public.control_state SET last_run_at = 'epoch'");
    await performAdvance();
  }
  data = await import("@/lib/traffic-data");
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.close();
});

const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);

describe("dashboard reads in live mode", () => {
  it("lists all 69 junctions with a level, a position and a reading time", async () => {
    const junctions = await data.fetchJunctions();
    expect(junctions).toHaveLength(69);
    for (const j of junctions) {
      expect(["LOW", "MODERATE", "HIGH"]).toContain(j.congestion_level);
      expect(finite(j.latitude) && finite(j.longitude)).toBe(true);
      expect(j.latitude).toBeGreaterThan(12.5);
      expect(j.latitude).toBeLessThan(13.5);
      expect(finite(j.avg_vehicle_count)).toBe(true);
      expect(j.name.length).toBeGreaterThan(2);
    }
    expect(new Set(junctions.map((j) => j.name)).size).toBe(69);
  });

  it("reads one junction's four approaches in display order with one green", async () => {
    const roads = await data.fetchRoadStates(1);
    expect(roads.map((r) => r.direction)).toEqual(["NORTH", "EAST", "SOUTH", "WEST"]);
    expect(roads.filter((r) => r.is_currently_green)).toHaveLength(1);
    for (const r of roads) {
      expect(r.green_duration_sec).toBeGreaterThanOrEqual(8);
      expect(r.green_duration_sec).toBeLessThanOrEqual(90);
      expect(finite(r.vehicle_count)).toBe(true);
      expect(r.phase_started_at).not.toBeNull();
    }
  });

  it("reads the cycle history with both waits", async () => {
    const cycles = await data.fetchCycleComparison(1);
    expect(cycles.length).toBeGreaterThan(0);
    for (const c of cycles) {
      expect(finite(c.delay_adaptive) && finite(c.delay_fixed)).toBe(true);
      expect(finite(c.adaptive_sec) && finite(c.fixed_sec)).toBe(true);
    }
  });

  it("reads the model state of each approach", async () => {
    const model = await data.fetchJunctionModel(1);
    expect(model).toHaveLength(4);
    for (const a of model) {
      expect(finite(a.arrival_rate_vph)).toBe(true);
      expect(finite(a.degree_saturation)).toBe(true);
      expect(finite(a.predicted_delay_adaptive_sec) && finite(a.predicted_delay_fixed_sec)).toBe(
        true,
      );
      expect(a.cycle_length_sec).toBeGreaterThanOrEqual(60);
    }
  });

  it("reads the network figures", async () => {
    const perf = await data.fetchModelPerformance();
    expect(finite(perf.networkDelayAdaptive) && finite(perf.networkDelayFixed)).toBe(true);
    expect(perf.junctionsTotal).toBe(69);
    expect(finite(perf.junctionsAdaptiveWorse)).toBe(true);
    const saved = await data.fetchTotalSecondsSaved();
    expect(finite(saved.seconds)).toBe(true);
    expect(saved.windowMin).toBeGreaterThanOrEqual(1);
    expect(saved.windowMin).toBeLessThanOrEqual(60);
  });

  it("reads the cameras and the detection feed without error", async () => {
    const tiles = await data.fetchCameraTiles(1);
    expect(Array.isArray(tiles)).toBe(true);
    expect(tiles.length).toBeGreaterThan(0);
    expect(Array.isArray(await data.fetchCctvFeed(1))).toBe(true);
  });
});
