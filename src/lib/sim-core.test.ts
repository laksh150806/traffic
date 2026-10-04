import { describe, expect, it } from "vitest";
import {
  FORCED_HANDOVER_SEC,
  INCIDENT_CAPACITY_FACTOR,
  MAX_HOLD_SEC,
  MAX_PHASE_SEC,
  MAX_RED_SEC,
  MEAN_DAY_FACTOR,
  MIN_PHASE_SEC,
  PREEMPT_MARGIN,
  approachDemandVph,
  approachPressure,
  decidePhase,
  effectiveGreenSeconds,
  incidentRoadId,
  istClock,
  levelFor,
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
    expect(timeOfDayFactor(atIst(18, 30))).toBeCloseTo(1.9);
    expect(timeOfDayFactor(atIst(9))).toBeCloseTo(1.75);
    expect(timeOfDayFactor(atIst(13))).toBeCloseTo(1.15);
    expect(timeOfDayFactor(atIst(21, 30))).toBeCloseTo(0.9);
    expect(timeOfDayFactor(atIst(3))).toBeCloseTo(0.45);
  });

  it("never jumps between two consecutive five-minute steps", () => {
    let previous = timeOfDayFactor(atIst(0));
    for (let minute = 5; minute <= 24 * 60; minute += 5) {
      const next = timeOfDayFactor(atIst(0, minute));
      expect(Math.abs(next - previous)).toBeLessThan(0.15);
      previous = next;
    }
  });

  it("wraps at midnight and averages about one over the day", () => {
    expect(timeOfDayFactor(atIst(23, 59))).toBeCloseTo(timeOfDayFactor(atIst(0, 0)), 1);
    expect(MEAN_DAY_FACTOR).toBeGreaterThan(0.85);
    expect(MEAN_DAY_FACTOR).toBeLessThan(1.15);
  });
});

describe("levelFor", () => {
  it("colours by mean saturation at the documented boundaries", () => {
    expect(levelFor(0.74)).toBe("LOW");
    expect(levelFor(0.75)).toBe("MODERATE");
    expect(levelFor(0.95)).toBe("HIGH");
  });

  it("raises a junction with one jammed arm even when the mean is low", () => {
    expect(levelFor(0.3, 45)).toBe("MODERATE");
    expect(levelFor(0.3, 90)).toBe("HIGH");
    expect(levelFor(0.3, 5)).toBe("LOW");
  });
});

describe("approachDemandVph and incidents", () => {
  it("scales with the time-of-day factor", () => {
    const base = { roadId: 7, maxCapacity: 120 };
    expect(approachDemandVph({ ...base, factor: 1.9 })).toBeGreaterThan(
      approachDemandVph({ ...base, factor: 0.45 }) * 4,
    );
  });

  it("blocks the busiest arm of the junction", () => {
    for (const index of [0, 10, 68]) {
      const ids = [0, 1, 2, 3].map((a) => index * 4 + a + 1);
      const blocked = incidentRoadId(index);
      expect(ids).toContain(blocked);
      expect(Math.max(...ids.map(loadFor))).toBe(loadFor(blocked));
    }
    expect(INCIDENT_CAPACITY_FACTOR).toBeLessThan(1);
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

  it("keeps the detector count fractional so quiet roads are not rounded away", () => {
    const quiet = stepQueue({ ...input, factor: 0.45, greenSeconds: 0 });
    expect(quiet.measuredArrivals).toBeGreaterThan(0);
    expect(Number.isInteger(quiet.measuredArrivals)).toBe(false);
  });

  it("a blocked lane serves fewer vehicles for the same green", () => {
    const open = stepQueue({ ...input, priorExact: 40, greenSeconds: 12 });
    const blocked = stepQueue({ ...input, priorExact: 40, greenSeconds: 12, capacityFactor: 0.3 });
    expect(blocked.exact).toBeGreaterThan(open.exact);
  });

  it("a demand boost raises arrivals", () => {
    const normal = stepQueue({ ...input, greenSeconds: 0 });
    const boosted = stepQueue({ ...input, greenSeconds: 0, demandBoost: 2.6 });
    expect(boosted.arrivals).toBeGreaterThan(normal.arrivals * 2);
  });
});

describe("effectiveGreenSeconds", () => {
  it("loses the start-up time of a phase that began inside the window", () => {
    expect(effectiveGreenSeconds(0, 0, 12_000)).toBe(8);
    expect(effectiveGreenSeconds(8_000, 0, 12_000)).toBe(0);
  });

  it("counts the whole window for a phase that has been running a while", () => {
    expect(effectiveGreenSeconds(-60_000, 0, 12_000)).toBe(12);
  });

  it("is never negative", () => {
    expect(effectiveGreenSeconds(50_000, 0, 12_000)).toBe(0);
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
      row(1, { isGreen: true, startedAtMs: NOW - 20_000, pressure: 0.5 }),
      row(2, { pressure: 0.5 + PREEMPT_MARGIN - 0.01 }),
    ];
    expect(decidePhase(base, NOW)).toBeNull();

    const worse = [base[0] as PhaseApproach, row(2, { pressure: 0.5 + PREEMPT_MARGIN + 0.05 })];
    expect(decidePhase(worse, NOW)?.startRoadId).toBe(2);
  });

  it("does not pre-empt before the green has held a share of its allocation", () => {
    // 30 s allocated, so the hold is 18 s: at 12 s even a much worse-off approach must wait.
    const early = [
      row(1, { isGreen: true, startedAtMs: NOW - 12_000, pressure: 0.2 }),
      row(2, { pressure: 3 }),
    ];
    expect(decidePhase(early, NOW)).toBeNull();
    const later = [
      row(1, { isGreen: true, startedAtMs: NOW - 19_000, pressure: 0.2 }),
      row(2, { pressure: 3 }),
    ];
    expect(decidePhase(later, NOW)?.startRoadId).toBe(2);
  });

  it("holds a short allocation only for the minimum phase time", () => {
    // 10 s allocated: 60 % of it is below the 8 s floor, so the floor applies.
    const rows = (elapsedMs: number) => [
      row(1, { isGreen: true, startedAtMs: NOW - elapsedMs, pressure: 0.2, allocatedGreen: 10 }),
      row(2, { pressure: 3 }),
    ];
    expect(decidePhase(rows(7_000), NOW)).toBeNull();
    expect(decidePhase(rows(8_500), NOW)?.startRoadId).toBe(2);
  });

  it("never holds a long allocation past the cap before pre-empting", () => {
    const decision = decidePhase(
      [
        row(1, {
          isGreen: true,
          startedAtMs: NOW - (MAX_HOLD_SEC + 1) * 1000,
          pressure: 0.2,
          allocatedGreen: 90,
        }),
        row(2, { pressure: 3 }),
      ],
      NOW,
    );
    expect(decision?.startRoadId).toBe(2);
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

  it("breaks ties by the longest wait, not the lowest road id", () => {
    const decision = decidePhase(
      [
        row(1, { isGreen: true, startedAtMs: NOW - 31_000 }),
        row(2, { pressure: 0.5, startedAtMs: NOW - 10_000 }),
        row(3, { pressure: 0.5, startedAtMs: NOW - 50_000 }),
      ],
      NOW,
    );
    expect(decision?.startRoadId).toBe(3);
  });

  it("lets waiting time outweigh a small pressure advantage", () => {
    const decision = decidePhase(
      [
        row(1, { isGreen: true, startedAtMs: NOW - 31_000 }),
        row(2, { pressure: 0.7, startedAtMs: NOW - 5_000 }),
        row(3, { pressure: 0.4, startedAtMs: NOW - 100_000 }),
      ],
      NOW,
    );
    expect(decision?.startRoadId).toBe(3);
  });

  it("serves an approach that has been red for too long, whatever the pressures say", () => {
    const decision = decidePhase(
      [
        row(1, { isGreen: true, startedAtMs: NOW - (FORCED_HANDOVER_SEC + 1) * 1000, pressure: 3 }),
        row(2, { pressure: 2.9, startedAtMs: NOW - 10_000 }),
        row(3, { pressure: 0.01, startedAtMs: NOW - (MAX_RED_SEC + 5) * 1000 }),
      ],
      NOW,
    );
    expect(decision).toMatchObject({ endRoadId: 1, startRoadId: 3 });
  });

  it("lets the running phase serve a usable green before an overdue arm takes over", () => {
    const overdue = row(2, { pressure: 0.01, startedAtMs: NOW - (MAX_RED_SEC + 5) * 1000 });
    const early = decidePhase(
      [row(1, { isGreen: true, startedAtMs: NOW - 12_000, pressure: 3 }), overdue],
      NOW,
    );
    expect(early).toBeNull();
    const later = decidePhase(
      [
        row(1, { isGreen: true, startedAtMs: NOW - (FORCED_HANDOVER_SEC + 1) * 1000, pressure: 3 }),
        overdue,
      ],
      NOW,
    );
    expect(later).toMatchObject({ endRoadId: 1, startRoadId: 2 });
  });

  it("does not freeze when the clock steps backwards", () => {
    const decision = decidePhase(
      [row(1, { isGreen: true, startedAtMs: NOW + 600_000 }), row(2, { pressure: 0.9 })],
      NOW,
    );
    expect(decision?.startRoadId).toBe(2);
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
    expect(approachPressure({ degreeSaturation: 0.8, queueNow: 20 })).toBeCloseTo(1.2);
  });
});

describe("weekend demand", () => {
  // 2026-10-03 is a Saturday, 2026-10-05 a Monday; both at the given Chennai hour.
  const at = (day: number, hour: number) =>
    new Date(Date.UTC(2026, 9, day) + (hour - 5.5) * 3600_000);

  it("has no commuter peak on a Saturday", () => {
    expect(timeOfDayFactor(at(5, 9))).toBeGreaterThan(1.7);
    expect(timeOfDayFactor(at(3, 9))).toBeLessThan(1.1);
  });

  it("peaks at the evening outing and stays below the working-day rush", () => {
    expect(timeOfDayFactor(at(3, 19))).toBeGreaterThan(1.4);
    expect(timeOfDayFactor(at(3, 19))).toBeLessThan(timeOfDayFactor(at(5, 18.5)));
  });

  it("is continuous across midnight into Sunday and into Monday", () => {
    const eps = 1 / 60;
    expect(Math.abs(timeOfDayFactor(at(3, 23.99)) - timeOfDayFactor(at(4, 0)))).toBeLessThan(eps);
    expect(Math.abs(timeOfDayFactor(at(4, 23.99)) - timeOfDayFactor(at(5, 0)))).toBeLessThan(eps);
  });

  it("reads the Chennai calendar day, not the UTC one", () => {
    // 20:00 UTC on Friday is 01:30 on Saturday in Chennai.
    const clock = istClock(new Date(Date.UTC(2026, 9, 2, 20, 0)));
    expect(clock.weekend).toBe(true);
    expect(clock.hour).toBeCloseTo(1.5, 5);
  });
});
