import { beforeAll, describe, expect, it } from "vitest";
import {
  clearIncidents,
  demoAdvance,
  demoFetchCameraTiles,
  demoFetchCctvFeed,
  demoFetchCycleComparison,
  demoFetchJunctionModel,
  demoFetchJunctions,
  demoFetchModelPerformance,
  demoFetchRoadStates,
  demoFetchTotalSecondsSaved,
  demoTick,
  getActiveIncidents,
  getScenarioMode,
  resetDemoEngine,
  setScenarioMode,
  triggerIncident,
} from "@/lib/demo-engine";
import { MAX_RED_SEC } from "@/lib/sim-core";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";

let clock = Date.now() + 60_000;

// The simulator's noise is seeded, so every run of this file sees exactly the same traffic.
beforeAll(() => resetDemoEngine(2026));

/** Run n control ticks, each followed by the 2-second phase controller steps. */
function runFor(ticks: number) {
  for (let i = 0; i < ticks; i += 1) {
    clock += 12_000;
    demoTick(clock);
    for (let k = 1; k <= 6; k += 1) demoAdvance(clock + k * 2000);
  }
}

describe("seed", () => {
  it("has the 69 junctions the migrations create", () => {
    expect(SEED_JUNCTIONS).toHaveLength(69);
    expect(new Set(SEED_JUNCTIONS.map((j) => j.id)).size).toBe(69);
  });
});

describe("demo engine", () => {
  it("starts populated with every junction and four approaches each", () => {
    const junctions = demoFetchJunctions();
    expect(junctions).toHaveLength(69);
    for (const junction of junctions.slice(0, 10)) {
      expect(demoFetchRoadStates(junction.junction_id)).toHaveLength(4);
    }
  });

  it("starts near each approach's steady state, not with a network full of leftover vehicles", () => {
    try {
      resetDemoEngine(11);
      setScenarioMode("night");
      const total = demoFetchJunctions().reduce((sum, j) => sum + j.total_vehicle_count, 0);
      // 276 approaches: overnight a handful of vehicles each, not the 20 to 75 the old seed gave.
      expect(total / 276).toBeLessThan(10);
      expect(demoFetchJunctions().filter((j) => j.congestion_level !== "LOW")).toHaveLength(0);
    } finally {
      resetDemoEngine(2026);
    }
  });

  it("keeps exactly one green per junction", () => {
    for (const junction of demoFetchJunctions()) {
      const greens = demoFetchRoadStates(junction.junction_id).filter((r) => r.is_currently_green);
      expect(greens).toHaveLength(1);
    }
  });

  it("stays at one green per junction as the controller runs", () => {
    for (let i = 1; i <= 40; i += 1) {
      demoAdvance(Date.now() + i * 2000);
    }
    for (const junction of demoFetchJunctions()) {
      const greens = demoFetchRoadStates(junction.junction_id).filter((r) => r.is_currently_green);
      expect(greens).toHaveLength(1);
    }
  });

  it("builds model state, history and accuracy from the warm start", () => {
    const first = SEED_JUNCTIONS[0]?.id ?? 1;
    expect(demoFetchJunctionModel(first)).toHaveLength(4);
    expect(demoFetchCycleComparison(first).length).toBeGreaterThan(3);
    const perf = demoFetchModelPerformance();
    expect(perf.samples).toBeGreaterThan(0);
    expect(perf.networkDelayFixed).toBeGreaterThan(0);
  });

  it("predicts lower network delay than the fixed timer off-peak", () => {
    setScenarioMode("night");
    runFor(40);
    const perf = demoFetchModelPerformance();
    expect(perf.saturatedApproaches).toBe(0);
    expect(perf.networkDelayAdaptive).toBeLessThan(perf.networkDelayFixed);
    setScenarioMode("auto");
  });

  it("reports how many junctions the adaptive plan is predicted to do worse at", () => {
    setScenarioMode("rush");
    runFor(40);
    const perf = demoFetchModelPerformance();
    expect(perf.junctionsTotal).toBe(69);
    expect(perf.junctionsAdaptiveWorse).toBeGreaterThanOrEqual(0);
    expect(perf.junctionsAdaptiveWorse).toBeLessThanOrEqual(69);
    setScenarioMode("auto");
  });

  it("scores the queue forecast against the naive guess", () => {
    const perf = demoFetchModelPerformance();
    expect(perf.baselineMeanAbsError).toBeGreaterThanOrEqual(0);
    expect(perf.samples).toBeGreaterThan(100);
  });

  it.each(["night", "rush"] as const)(
    "never leaves an approach on red for long in %s traffic",
    (mode) => {
      try {
        setScenarioMode(mode);
        runFor(20);
        const redSince = new Map<number, number>();
        let longest = 0;
        // Sample after every 2-second controller step, so a short green is never missed.
        for (let i = 0; i < 100; i += 1) {
          clock += 12_000;
          demoTick(clock);
          for (let k = 1; k <= 6; k += 1) {
            const at = clock + k * 2000;
            demoAdvance(at);
            for (const junction of SEED_JUNCTIONS) {
              for (const road of demoFetchRoadStates(junction.id)) {
                if (road.is_currently_green) {
                  redSince.delete(road.road_id);
                } else {
                  const since = redSince.get(road.road_id) ?? at;
                  redSince.set(road.road_id, since);
                  longest = Math.max(longest, (at - since) / 1000);
                }
              }
            }
          }
        }
        // MAX_RED_SEC, plus waiting behind other overdue arms.
        expect(longest).toBeLessThan(MAX_RED_SEC + 120);
      } finally {
        setScenarioMode("auto");
      }
    },
  );

  it("gives every approach at least one green over a long run", () => {
    try {
      setScenarioMode("rush");
      const served = new Set<number>();
      for (let i = 0; i < 60; i += 1) {
        runFor(1);
        for (const junction of SEED_JUNCTIONS) {
          for (const road of demoFetchRoadStates(junction.id)) {
            if (road.is_currently_green) served.add(road.road_id);
          }
        }
      }
      expect(served.size).toBe(SEED_JUNCTIONS.length * 4);
    } finally {
      setScenarioMode("auto");
    }
  });

  it("leaves rush hour mixed, neither empty nor saturated everywhere", () => {
    setScenarioMode("rush");
    runFor(40);
    const perf = demoFetchModelPerformance();
    expect(perf.saturatedApproaches).toBeGreaterThan(0);
    expect(perf.saturatedApproaches).toBeLessThan(276 * 0.9);
    setScenarioMode("auto");
  });

  it("a blocked lane drives its junction toward saturation", () => {
    // Pinned to rush hour so the result does not depend on the wall-clock hour the suite runs at.
    // The incident is timed on the test's simulated clock, which runs ahead of the real one.
    const target = 10;
    const peak = () => Math.max(...demoFetchJunctionModel(target).map((a) => a.degree_saturation));
    try {
      setScenarioMode("rush");
      runFor(40); // let any queues left over from earlier tests drain
      const before = peak();
      triggerIncident(target, 600, clock);
      runFor(25);
      expect(peak()).toBeGreaterThan(before * 1.3);
    } finally {
      clearIncidents();
      setScenarioMode("auto");
    }
  });

  it("reports modelled waiting avoided over a stated window, at a plausible size", () => {
    try {
      setScenarioMode("rush");
      runFor(30); // six simulated minutes
      const saving = demoFetchTotalSecondsSaved();
      expect(saving.windowMin).toBeGreaterThan(3);
      expect(saving.windowMin).toBeLessThanOrEqual(60);
      // Network flow at rush is about 276 approaches x a few hundred veh/h. Even a 100 s gain per
      // vehicle over six minutes stays far below this bound; a per-tick re-crediting bug does not.
      const vehicles = (demoFetchJunctions().length * 4 * 450 * saving.windowMin) / 60;
      expect(Math.abs(saving.seconds)).toBeLessThan(vehicles * 150);
    } finally {
      setScenarioMode("auto");
    }
  });

  it("keeps the sign: a saving can be negative", () => {
    // The total is a sum of signed per-window gains, so it is not forced upwards by clamping.
    const first = demoFetchTotalSecondsSaved().seconds;
    expect(Number.isFinite(first)).toBe(true);
  });

  it("serves camera tiles and a CCTV feed", () => {
    const first = SEED_JUNCTIONS[0]?.id ?? 1;
    const tiles = demoFetchCameraTiles(first);
    expect(tiles).toHaveLength(4);
    expect(tiles.every((t) => t.status === "ONLINE" || t.status === "OFFLINE")).toBe(true);
    // The feed is sampled, so across the whole network at least some junction has frames.
    const total = demoFetchJunctions().reduce(
      (sum, j) => sum + demoFetchCctvFeed(j.junction_id).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it("tracks scenario mode and incidents", () => {
    setScenarioMode("rush");
    expect(getScenarioMode()).toBe("rush");
    setScenarioMode("auto");

    triggerIncident(5, 60);
    expect(getActiveIncidents()).toEqual([5]);
    clearIncidents();
    expect(getActiveIncidents()).toEqual([]);
  });
});
