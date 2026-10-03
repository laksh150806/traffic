import { describe, expect, it } from "vitest";
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
  setScenarioMode,
  triggerIncident,
} from "@/lib/demo-engine";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";

let clock = Date.now() + 60_000;

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

  it("predicts clearly lower network delay than the fixed plan off-peak", () => {
    setScenarioMode("night");
    runFor(40);
    const perf = demoFetchModelPerformance();
    expect(perf.saturatedApproaches).toBe(0);
    expect(perf.networkDelayAdaptive).toBeLessThan(perf.networkDelayFixed * 0.8);
    setScenarioMode("auto");
  });

  it("leaves rush hour mixed, neither empty nor saturated everywhere", () => {
    setScenarioMode("rush");
    runFor(40);
    const perf = demoFetchModelPerformance();
    expect(perf.saturatedApproaches).toBeGreaterThan(0);
    expect(perf.saturatedApproaches).toBeLessThan(276 * 0.9);
    setScenarioMode("auto");
  });

  it("an incident drives its junction toward saturation", () => {
    // Pinned to night so the result does not depend on the wall-clock hour the suite runs at.
    // The incident is timed on the test's simulated clock, which runs ahead of the real one.
    const target = 10;
    const peak = () => Math.max(...demoFetchJunctionModel(target).map((a) => a.degree_saturation));
    try {
      setScenarioMode("night");
      runFor(40); // let any queues left over from earlier tests drain
      const before = peak();
      triggerIncident(target, 600, clock);
      runFor(25);
      expect(peak()).toBeGreaterThan(before * 1.5);
    } finally {
      clearIncidents();
      setScenarioMode("auto");
    }
  });

  it("accumulates avoided waiting as it ticks", () => {
    const before = demoFetchTotalSecondsSaved();
    demoTick(Date.now() + 30_000);
    expect(demoFetchTotalSecondsSaved()).toBeGreaterThanOrEqual(before);
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
