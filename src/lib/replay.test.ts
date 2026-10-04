import { describe, expect, it } from "vitest";
import { replayJunction } from "@/lib/replay";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";

// Monday 5 October 2026 at the given Chennai hour.
const at = (hour: number) => Date.UTC(2026, 9, 5) + (hour - 5.5) * 3600_000;

const network = (ms: number) => {
  const results = SEED_JUNCTIONS.map((_, i) => replayJunction(i, ms).summary);
  return {
    results,
    mean: results.reduce((sum, r) => sum + r.waitChangePercent, 0) / results.length,
    worse: results.filter((r) => r.waitAdaptive > r.waitFixed).length,
  };
};

describe("replayJunction", () => {
  it("is repeatable and covers the whole window", () => {
    const a = replayJunction(10, at(9));
    const b = replayJunction(10, at(9));
    expect(b).toEqual(a);
    expect(a.seconds).toHaveLength(150); // 30 minutes in 12 second windows
    expect(a.fixed).toHaveLength(150);
    expect(a.adaptive).toHaveLength(150);
    expect(a.seconds[0]).toBe(12);
    expect(a.seconds.at(-1)).toBe(1800);
  });

  it("starts both runs from the same queues, so the comparison is fair", () => {
    const r = replayJunction(10, at(9));
    // One window in, the two runs have diverged by at most a few vehicles from the shared start.
    expect(Math.abs((r.fixed[0] ?? 0) - (r.adaptive[0] ?? 0))).toBeLessThan(25);
  });

  it("reports fields that agree with each other", () => {
    const { summary: s } = replayJunction(20, at(18.5));
    expect(s.maxQueueFixed).toBeGreaterThanOrEqual(s.avgQueueFixed);
    expect(s.maxQueueAdaptive).toBeGreaterThanOrEqual(s.avgQueueAdaptive);
    expect(s.servedFixed).toBeGreaterThan(0);
    expect(s.servedAdaptive).toBeGreaterThan(0);
    expect(s.arrivalsPerHour).toBeGreaterThan(0);
    const expected = ((s.avgQueueFixed - s.avgQueueAdaptive) / s.avgQueueFixed) * 100;
    expect(Math.abs(s.waitChangePercent - expected)).toBeLessThanOrEqual(1);
  });

  it("beats the fixed timer across the network at the commuter peaks", () => {
    for (const hour of [9, 18.5]) {
      const { mean, worse } = network(at(hour));
      expect(mean).toBeGreaterThan(25);
      expect(worse).toBeLessThanOrEqual(10);
    }
  });

  it("does not lose to the fixed timer overnight", () => {
    const { mean, worse } = network(at(3));
    expect(mean).toBeGreaterThan(5);
    expect(worse).toBeLessThanOrEqual(5);
  });

  it("keeps every approach's red within about two minutes and a half, even at the peak", () => {
    const { results } = network(at(18.5));
    for (const r of results) expect(r.longestRedAdaptive).toBeLessThanOrEqual(150);
  });

  it("does not hand the green over more often than the fixed timer would by a wide margin", () => {
    const { results } = network(at(9));
    const ratio =
      results.reduce((sum, r) => sum + r.switchesAdaptive, 0) /
      results.reduce((sum, r) => sum + r.switchesFixed, 0);
    expect(ratio).toBeLessThan(1.3);
  });

  it("shows a blocked lane hurting both controllers", () => {
    const clear = replayJunction(10, at(13)).summary;
    const blocked = replayJunction(10, at(13), { blocked: true }).summary;
    expect(blocked.avgQueueFixed).toBeGreaterThan(clear.avgQueueFixed);
    expect(blocked.avgQueueAdaptive).toBeGreaterThan(clear.avgQueueAdaptive);
  });

  it("rejects an unknown junction", () => {
    expect(() => replayJunction(999, at(9))).toThrow(RangeError);
  });
});
