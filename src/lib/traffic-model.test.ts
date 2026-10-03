import { describe, expect, it } from "vitest";
import {
  FIXED_GREEN,
  MAX_CYCLE,
  MAX_GREEN,
  MIN_CYCLE,
  MIN_GREEN,
  clamp,
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

  it("fixed plan pays lost time: 120 s cycle gives 26 s green per approach", () => {
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

  it("grows with demand", () => {
    const low = websterDelay({ ...base, arrivalRateVph: 200 });
    const high = websterDelay({ ...base, arrivalRateVph: 600 });
    expect(high).toBeGreaterThan(low);
  });

  it("shrinks when the approach gets more green", () => {
    const short = websterDelay({ ...base, green: 20, arrivalRateVph: 400 });
    const long = websterDelay({ ...base, green: 50, arrivalRateVph: 400 });
    expect(long).toBeLessThan(short);
  });

  it("stays bounded when oversaturated", () => {
    const d = websterDelay({ ...base, arrivalRateVph: 5000 });
    expect(d).toBeLessThanOrEqual(600);
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
    const greens = new Set(model.approaches.map((a) => a.green));
    expect(greens.size).toBe(1);
  });

  it("predicts lower waits than the fixed plan when demand is lopsided", () => {
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
});
