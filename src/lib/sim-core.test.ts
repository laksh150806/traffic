import { describe, expect, it } from "vitest";
import {
  MAX_PHASE_SEC,
  MIN_PHASE_SEC,
  PREEMPT_MARGIN,
  approachPressure,
  decidePhase,
  greenSecondsHeld,
  loadFor,
  stepQueue,
  timeOfDayFactor,
  type PhaseApproach,
} from "@/lib/sim-core";

describe("loadFor", () => {
  it("is deterministic and bounded", () => {
    for (let id = 1; id <= 300; id += 1) {
      const v = loadFor(id);
      expect(v).toBe(loadFor(id));
      expect(v).toBeGreaterThanOrEqual(0.45);
      expect(v).toBeLessThanOrEqual(1.4);
    }
  });
});

describe("timeOfDayFactor (IST)", () => {
  const atIst = (h: number, m = 0) => {
    const minutes = h * 60 + m - 330; // IST is UTC+5:30
    return new Date(Date.UTC(2026, 0, 5, 0, 0) + minutes * 60_000);
  };

  it("peaks in the evening rush and falls at night", () => {
    expect(timeOfDayFactor(atIst(18, 30))).toBe(1.9);
    expect(timeOfDayFactor(atIst(9))).toBe(1.75);
    expect(timeOfDayFactor(atIst(13))).toBe(1.15);
    expect(timeOfDayFactor(atIst(21))).toBe(0.9);
    expect(timeOfDayFactor(atIst(3))).toBe(0.45);
  });
});

describe("stepQueue", () => {
  const input = {
    roadId: 7,
    maxCapacity: 120,
    factor: 1.15,
    elapsedSec: 12,
    priorExact: 10,
    rand: () => 0.5,
  };

  it("grows while the approach is on red", () => {
    const step = stepQueue({ ...input, greenSeconds: 0 });
    expect(step.exact).toBeGreaterThan(input.priorExact);
    expect(step.arrivals).toBeGreaterThan(0);
  });

  it("drains while the approach holds the green", () => {
    const step = stepQueue({ ...input, greenSeconds: 12 });
    expect(step.exact).toBeLessThan(input.priorExact);
  });

  it("never goes negative or above the 150 cap", () => {
    expect(stepQueue({ ...input, priorExact: 0, greenSeconds: 120 }).exact).toBe(0);
    expect(stepQueue({ ...input, priorExact: 149, elapsedSec: 120, greenSeconds: 0 }).exact).toBe(
      150,
    );
  });

  it("a demand boost raises arrivals", () => {
    const normal = stepQueue({ ...input, greenSeconds: 0 });
    const boosted = stepQueue({ ...input, greenSeconds: 0, demandBoost: 2.6 });
    expect(boosted.arrivals).toBeGreaterThan(normal.arrivals * 2);
  });
});

describe("greenSecondsHeld", () => {
  it("is zero off green and capped by the allocation on green", () => {
    expect(greenSecondsHeld(false, 12, 30)).toBe(0);
    expect(greenSecondsHeld(true, 12, 30)).toBe(12);
    expect(greenSecondsHeld(true, 40, 30)).toBe(30);
  });
});

describe("decidePhase", () => {
  const NOW = 1_000_000;
  const row = (roadId: number, over: Partial<PhaseApproach> = {}): PhaseApproach => ({
    roadId,
    isGreen: false,
    startedAtMs: NOW,
    allocatedGreen: 30,
    pressure: 0.5,
    ...over,
  });

  it("keeps a running green until it has served its allocation", () => {
    const decision = decidePhase(
      [row(1, { isGreen: true, startedAtMs: NOW - 10_000 }), row(2), row(3), row(4)],
      NOW,
    );
    expect(decision).toBeNull();
  });

  it("hands over after the allocation, to the highest pressure", () => {
    const decision = decidePhase(
      [
        row(1, { isGreen: true, startedAtMs: NOW - 31_000 }),
        row(2, { pressure: 0.4 }),
        row(3, { pressure: 0.9 }),
        row(4, { pressure: 0.6 }),
      ],
      NOW,
    );
    expect(decision?.endRoadId).toBe(1);
    expect(decision?.startRoadId).toBe(3);
  });

  it("pre-empts early only when another approach is clearly worse off", () => {
    const base = [
      row(1, { isGreen: true, startedAtMs: NOW - 12_000, pressure: 0.5 }),
      row(2, { pressure: 0.5 + PREEMPT_MARGIN - 0.01 }),
    ];
    expect(decidePhase(base, NOW)).toBeNull();

    const worse = [base[0] as PhaseApproach, row(2, { pressure: 0.5 + PREEMPT_MARGIN + 0.05 })];
    expect(decidePhase(worse, NOW)?.startRoadId).toBe(2);
  });

  it("never pre-empts before the minimum phase time", () => {
    const decision = decidePhase(
      [
        row(1, { isGreen: true, startedAtMs: NOW - (MIN_PHASE_SEC - 2) * 1000, pressure: 0.1 }),
        row(2, { pressure: 5 }),
      ],
      NOW,
    );
    expect(decision).toBeNull();
  });

  it("starts someone when nobody holds the green", () => {
    const decision = decidePhase([row(1, { pressure: 0.2 }), row(2, { pressure: 0.7 })], NOW);
    expect(decision).toEqual({ endRoadId: null, startRoadId: 2, startGreen: 30 });
  });

  it("clamps the next green into the allowed range", () => {
    const long = decidePhase([row(1, { allocatedGreen: 500 })], NOW);
    const short = decidePhase([row(1, { allocatedGreen: 1 })], NOW);
    expect(long?.startGreen).toBe(MAX_PHASE_SEC);
    expect(short?.startGreen).toBe(MIN_PHASE_SEC);
  });
});

describe("approachPressure", () => {
  it("is zero without a model and adds queue weight otherwise", () => {
    expect(approachPressure(null)).toBe(0);
    expect(approachPressure({ degreeSaturation: 0.8, queueNow: 20 })).toBeCloseTo(0.9);
  });
});
