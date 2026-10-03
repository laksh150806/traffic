import { describe, expect, it } from "vitest";
import {
  FIXED_GREEN,
  LOST_TIME_PER_PHASE,
  MAX_CYCLE,
  MAX_GREEN,
  MIN_CYCLE,
  MIN_GREEN,
  clamp,
  fixedPlanFromDemand,
  planSignals,
  saturationFlow,
  solveJunction,
  websterDelay,
  type ApproachInput,
} from "@/lib/traffic-model";

const approach = (roadId: number, queue: number, overrides: Partial<ApproachInput> = {}) => ({
  roadId,
  queue,
  previousQueue: queue,
  previousGreen: 20,
  previousArrivalRate: null,
  measuredArrivals: null,
  maxCapacity: 120,
  ...overrides,
});

/** A junction whose four arms each see `rates[i]` vehicles per hour. */
const junctionAt = (rates: number[], elapsedSec = 12) =>
  rates.map((vph, i) => approach(i + 1, 0, { measuredArrivals: (vph / 3600) * elapsedSec }));

describe("clamp and saturation flow", () => {
  it("clamps both ends", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it("scales with lane capacity but stays inside 900 to 2400 veh/h", () => {
    expect(saturationFlow(100)).toBe(1800);
    expect(saturationFlow(10)).toBe(900);
    expect(saturationFlow(1000)).toBe(2400);
  });

  it("applies a capacity factor after the clamp, for blocked lanes", () => {
    expect(saturationFlow(100, 0.5)).toBe(900);
    expect(saturationFlow(10, 0.5)).toBe(450);
  });

  it("naive fixed plan pays lost time: 120 s cycle gives 26 s green per approach", () => {
    expect(FIXED_GREEN).toBe(26);
  });
});

describe("websterDelay", () => {
  const base = { cycle: 120, green: 26, saturationFlowVph: 1800 };

  it("is finite and non-negative for zero demand", () => {
    const d = websterDelay({ ...base, arrivalRateVph: 0 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(0);
  });

  it("is pure red-time delay at zero demand", () => {
    // 0.5 * C * (1 - g/C)^2 / (1 - 0)
    expect(websterDelay({ ...base, arrivalRateVph: 0 })).toBeCloseTo(
      0.5 * 120 * (1 - 26 / 120) ** 2,
      5,
    );
  });

  it("grows with demand", () => {
    const low = websterDelay({ ...base, arrivalRateVph: 200 });
    const high = websterDelay({ ...base, arrivalRateVph: 600 });
    expect(high).toBeGreaterThan(low);
  });

  it("never falls as demand rises, including through capacity", () => {
    let previous = 0;
    for (let q = 0; q <= 3000; q += 25) {
      const d = websterDelay({ ...base, arrivalRateVph: q });
      expect(d).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = d;
    }
  });

  it("has no jump where demand crosses capacity", () => {
    // capacity = 1800 * 26/120 = 390 veh/h
    const below = websterDelay({ ...base, arrivalRateVph: 389 });
    const above = websterDelay({ ...base, arrivalRateVph: 391 });
    expect(Math.abs(above - below)).toBeLessThan(5);
  });

  it("shrinks when the approach gets more green", () => {
    const short = websterDelay({ ...base, green: 20, arrivalRateVph: 400 });
    const long = websterDelay({ ...base, green: 50, arrivalRateVph: 400 });
    expect(long).toBeLessThan(short);
  });

  it("never rises as green increases, at any demand", () => {
    for (const q of [100, 390, 450, 900]) {
      let previous = Infinity;
      for (let green = 10; green <= 90; green += 4) {
        const d = websterDelay({ ...base, green, arrivalRateVph: q });
        expect(d).toBeLessThanOrEqual(previous + 1e-9);
        previous = d;
      }
    }
  });

  it("stays bounded when oversaturated", () => {
    const d = websterDelay({ ...base, arrivalRateVph: 5000 });
    expect(d).toBeLessThanOrEqual(600);
  });
});

describe("planSignals", () => {
  it("always makes the cycle the sum of the greens plus lost time", () => {
    const cases = [
      [0.01, 0.01, 0.01, 0.01],
      [0.05, 0.05, 0.05, 0.5],
      [0.2, 0.2, 0.2, 0.2],
      [0.95, 0.95, 0.95, 0.95],
      [0.3, 0.01, 0.3, 0.01],
    ];
    for (const ratios of cases) {
      const plan = planSignals(ratios);
      const lost = ratios.length * LOST_TIME_PER_PHASE;
      expect(plan.greens.reduce((a, b) => a + b, 0) + lost).toBe(plan.cycle);
      expect(plan.cycle).toBeGreaterThanOrEqual(MIN_CYCLE);
      expect(plan.cycle).toBeLessThanOrEqual(MAX_CYCLE);
      plan.greens.forEach((g) => {
        expect(g).toBeGreaterThanOrEqual(MIN_GREEN);
        expect(g).toBeLessThanOrEqual(MAX_GREEN);
      });
    }
  });

  it("gives a busier phase a longer green", () => {
    const plan = planSignals([0.1, 0.4, 0.1, 0.1]);
    expect(plan.greens[1]).toBeGreaterThan(plan.greens[0] ?? 0);
  });

  it("makes the fixed plan from long-run demand, not the naive split", () => {
    const plan = fixedPlanFromDemand([100, 100, 100, 700], [1800, 1800, 1800, 1800]);
    expect(plan.greens[3]).toBeGreaterThan(plan.greens[0] ?? 0);
  });
});

describe("solveJunction", () => {
  it("keeps cycle and greens inside their limits", () => {
    const model = solveJunction(
      [approach(1, 5), approach(2, 120), approach(3, 40), approach(4, 0)],
      12,
    );
    expect(model.cycleLength).toBeGreaterThanOrEqual(MIN_CYCLE);
    expect(model.cycleLength).toBeLessThanOrEqual(MAX_CYCLE);
    for (const a of model.approaches) {
      expect(a.green).toBeGreaterThanOrEqual(MIN_GREEN);
      expect(a.green).toBeLessThanOrEqual(MAX_GREEN);
    }
  });

  it("reports a cycle equal to its greens plus lost time, however lopsided the demand", () => {
    for (const rates of [
      [60, 60, 60, 60],
      [60, 60, 60, 900],
      [900, 900, 60, 60],
      [1400, 1400, 1400, 1400],
    ]) {
      const model = solveJunction(junctionAt(rates), 12);
      const greens = model.approaches.reduce((sum, a) => sum + a.green, 0);
      expect(greens + model.approaches.length * LOST_TIME_PER_PHASE).toBe(model.cycleLength);
    }
  });

  it("does not understate delay for one dominant arm (cycle consistent with greens)", () => {
    const model = solveJunction(junctionAt([60, 60, 60, 900]), 12);
    expect(model.delayAdaptive).toBeGreaterThan(20);
  });

  it("gives more green to the busier approach", () => {
    const model = solveJunction(
      [
        approach(1, 10, { measuredArrivals: 0 }),
        approach(2, 40, { measuredArrivals: 2 }),
        approach(3, 10, { measuredArrivals: 0 }),
        approach(4, 10, { measuredArrivals: 0 }),
      ],
      12,
    );
    const busy = model.approaches.find((a) => a.roadId === 2);
    const quiet = model.approaches.find((a) => a.roadId === 1);
    expect(busy && quiet && busy.green > quiet.green).toBe(true);
  });

  it("splits evenly when every approach is identical", () => {
    const model = solveJunction(
      [1, 2, 3, 4].map((id) => approach(id, 30)),
      12,
    );
    const greens = model.approaches.map((a) => a.green);
    expect(Math.max(...greens) - Math.min(...greens)).toBeLessThanOrEqual(1);
  });

  it("predicts lower waits than the naive timer when demand is lopsided", () => {
    const model = solveJunction(
      [
        approach(1, 60, { measuredArrivals: 3 }),
        approach(2, 2, { measuredArrivals: 0 }),
        approach(3, 2, { measuredArrivals: 0 }),
        approach(4, 2, { measuredArrivals: 0 }),
      ],
      12,
    );
    expect(model.delayAdaptive).toBeLessThan(model.delayFixed);
  });

  it("compares against the fixed plan it is given", () => {
    const rates = [600, 100, 600, 100];
    const same = solveJunction(junctionAt(rates), 12);
    const tuned = solveJunction(
      junctionAt(rates),
      12,
      fixedPlanFromDemand(rates, [2160, 2160, 2160, 2160]),
    );
    expect(tuned.delayFixed).not.toBe(same.delayFixed);
    expect(tuned.delayFixed).toBeLessThan(same.delayFixed);
  });

  it("handles a junction with a single approach", () => {
    const model = solveJunction([approach(1, 20)], 12);
    expect(model.approaches).toHaveLength(1);
    expect(model.approaches[0]?.green).toBeGreaterThanOrEqual(MIN_GREEN);
  });

  it("flags a queue that cannot clear", () => {
    const model = solveJunction(
      [approach(1, 140, { measuredArrivals: 7 }), approach(2, 140, { measuredArrivals: 7 })],
      12,
    );
    expect(model.approaches.some((a) => !a.queueClears)).toBe(true);
  });

  it("does not floor quiet roads at 60 veh/h", () => {
    const model = solveJunction(junctionAt([20, 20, 20, 20]), 12);
    for (const a of model.approaches) expect(a.arrivalRateVph).toBeLessThan(40);
  });

  it("smooths the arrival estimate towards the detector without bias", () => {
    let estimate: number | null = null;
    for (let i = 0; i < 60; i += 1) {
      // A detector that sees a fractional count each window, averaging 100 veh/h.
      const model = solveJunction(
        [approach(1, 0, { measuredArrivals: 100 / 300, previousArrivalRate: estimate })],
        12,
      );
      estimate = model.approaches[0]?.arrivalRateVph ?? null;
    }
    expect(estimate).toBeGreaterThan(95);
    expect(estimate).toBeLessThan(105);
  });

  it("credits a saving per window and keeps its sign", () => {
    const naive = solveJunction(junctionAt([60, 60, 60, 900]), 12);
    const saved = naive.approaches.reduce((sum, a) => sum + a.savedVehicleSeconds, 0);
    expect(saved).toBeGreaterThan(0);

    // Against a timer that is already right for this demand, the adaptive plan has nothing to add.
    const right = solveJunction(
      junctionAt([60, 60, 60, 900]),
      12,
      fixedPlanFromDemand([60, 60, 60, 900], [2160, 2160, 2160, 2160]),
    );
    const net = right.approaches.reduce((sum, a) => sum + a.savedVehicleSeconds, 0);
    expect(Math.abs(net)).toBeLessThan(Math.abs(saved));
  });

  it("scales the saving with the length of the window, not the cycle", () => {
    const short = solveJunction(junctionAt([60, 60, 60, 900], 12), 12);
    const long = solveJunction(junctionAt([60, 60, 60, 900], 24), 24);
    const total = (m: typeof short) => m.approaches.reduce((s, a) => s + a.savedVehicleSeconds, 0);
    expect(total(long)).toBeGreaterThan(total(short) * 1.8);
    expect(total(long)).toBeLessThan(total(short) * 2.2);
  });
});
