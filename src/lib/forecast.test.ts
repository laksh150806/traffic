import { describe, expect, it } from "vitest";
import { demoFetchRoadStates } from "@/lib/demo-engine";
import {
  dayProfile,
  forecastAsSummary,
  forecastJunction,
  forecastNetwork,
  formatIstTime,
  istDate,
  istHourOf,
  roadIdFor,
} from "@/lib/forecast";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";

describe("forecast", () => {
  it("numbers roads the way the demo engine does", () => {
    for (const index of [0, 7, 68]) {
      const seed = SEED_JUNCTIONS[index];
      const ids = demoFetchRoadStates(seed!.id).map((r) => r.road_id);
      expect(ids.sort((a, b) => a - b)).toEqual([0, 1, 2, 3].map((a) => roadIdFor(index, a)));
    }
  });

  it("reads Chennai wall-clock time", () => {
    expect(istHourOf(istDate(18, 30))).toBeCloseTo(18.5);
    expect(formatIstTime(istDate(9, 5))).toBe("9:05 am");
    expect(formatIstTime(istDate(0, 0))).toBe("12:00 am");
    expect(formatIstTime(istDate(12, 0))).toBe("12:00 pm");
  });

  it("is busier at the evening peak than at 3 am for every junction", () => {
    const night = forecastNetwork(istDate(3));
    const peak = forecastNetwork(istDate(18, 30));
    night.forEach((n, i) => expect(peak[i]!.saturation).toBeGreaterThan(n.saturation));
  });

  it("never predicts a longer wait for the adaptive plan than the fixed plan off-peak", () => {
    const night = forecastNetwork(istDate(3));
    const worse = night.filter((f) => f.delayAdaptive > f.delayFixed + 0.5);
    expect(worse).toHaveLength(0);
  });

  it("raises congestion when an incident boosts demand", () => {
    const calm = forecastJunction(10, istDate(12));
    const blocked = forecastJunction(10, istDate(12), 2.6);
    expect(blocked.saturation).toBeGreaterThan(calm.saturation);
    expect(blocked.queue).toBeGreaterThan(calm.queue);
  });

  it("gives a 24-hour day profile and a summary in the data layer's shape", () => {
    const profile = dayProfile(0);
    expect(profile).toHaveLength(24);
    const summary = forecastAsSummary(forecastJunction(0, istDate(18)));
    expect(summary.junction_id).toBe(SEED_JUNCTIONS[0]!.id);
    expect(["LOW", "MODERATE", "HIGH"]).toContain(summary.congestion_level);
  });
});
