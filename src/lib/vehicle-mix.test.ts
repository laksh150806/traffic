import { describe, expect, it } from "vitest";
import { AVG_PCU, AVG_SPACE_M, CLASSES, carEquivalents, queueLengthM } from "@/lib/vehicle-mix";

describe("vehicle mix", () => {
  it("shares add up to the whole traffic stream", () => {
    expect(CLASSES.reduce((sum, c) => sum + c.share, 0)).toBeCloseTo(1, 6);
  });

  it("an average vehicle is smaller than a car, as it should be where two-wheelers dominate", () => {
    expect(AVG_PCU).toBeLessThan(1);
    expect(AVG_PCU).toBeGreaterThan(0.6);
    expect(AVG_SPACE_M).toBeLessThan(6);
    expect(AVG_SPACE_M).toBeGreaterThan(2.5);
  });

  it("measures queues in metres and car-equivalents", () => {
    expect(queueLengthM(0)).toBe(0);
    expect(queueLengthM(-5)).toBe(0);
    expect(queueLengthM(40)).toBeGreaterThan(40);
    expect(queueLengthM(40)).toBeLessThan(120);
    expect(queueLengthM(80)).toBeCloseTo(queueLengthM(40) * 2, 6);
    expect(carEquivalents(100)).toBeCloseTo(100 * AVG_PCU, 6);
  });

  it("a queue spread over more lanes is shorter", () => {
    expect(queueLengthM(60, 3)).toBeLessThan(queueLengthM(60, 2));
    expect(queueLengthM(60, 0)).toBeGreaterThan(0);
  });
});
