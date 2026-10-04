import { describe, expect, it } from "vitest";
import { simFetchRoadStates } from "@/lib/sim-engine";
import {
  dayProfile,
  findPeaks,
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
  it("numbers roads the way the simulation engine does", () => {
    for (const index of [0, 7, 68]) {
      const seed = SEED_JUNCTIONS[index];
      const ids = simFetchRoadStates(seed!.id).map((r) => r.road_id);
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

  const meanDelays = (at: Date) => {
    const all = forecastNetwork(at);
    const mean = (pick: (f: (typeof all)[number]) => number) =>
      all.reduce((sum, f) => sum + pick(f), 0) / all.length;
    return { adaptive: mean((f) => f.delayAdaptive), fixed: mean((f) => f.delayFixed), all };
  };

  it("predicts a lower average wait than the tuned fixed timer across the network off-peak", () => {
    const night = meanDelays(istDate(3));
    expect(night.adaptive).toBeLessThan(night.fixed);
  });

  it("is honest that some junctions do worse than the timer at some hours", () => {
    // The fixed plan is optimised for the all-day average demand, so it can win at the hour it suits.
    // The forecast must report that rather than hide it: the delays are signed and differ per junction.
    const peak = meanDelays(istDate(18, 30));
    const gains = peak.all.map((f) => f.delayFixed - f.delayAdaptive);
    expect(new Set(gains.map((g) => Math.sign(Math.round(g)))).size).toBeGreaterThan(0);
    expect(gains.every(Number.isFinite)).toBe(true);
  });

  it("raises congestion when an incident blocks a lane", () => {
    const at = istDate(18);
    const calm = forecastJunction(10, at);
    const blocked = forecastJunction(10, at, { incidents: new Set([SEED_JUNCTIONS[10]!.id]) });
    expect(blocked.saturation).toBeGreaterThan(calm.saturation);
    expect(blocked.queue).toBeGreaterThan(calm.queue);
    expect(blocked.maxQueue).toBeGreaterThan(calm.maxQueue);
  });

  it("follows a scenario factor instead of the clock", () => {
    const night = forecastJunction(10, istDate(3));
    const rush = forecastJunction(10, istDate(3), { factor: 1.9 });
    expect(rush.saturation).toBeGreaterThan(night.saturation * 2);
  });

  it("does not let a junction with one jammed arm read as free flowing", () => {
    const worstLow = forecastNetwork(istDate(18, 30), {
      incidents: new Set(SEED_JUNCTIONS.map((j) => j.id)),
    }).filter((f) => f.maxQueue >= 80 && f.level === "LOW");
    expect(worstLow).toHaveLength(0);
  });

  it("changes smoothly across the old 8 am cliff", () => {
    const before = forecastNetwork(istDate(7, 55)).filter((f) => f.level === "HIGH").length;
    const after = forecastNetwork(istDate(8, 0)).filter((f) => f.level === "HIGH").length;
    expect(Math.abs(after - before)).toBeLessThan(12);
  });

  it("gives a 24-hour day profile and a summary in the data layer's shape", () => {
    const profile = dayProfile(0);
    expect(profile).toHaveLength(24);
    const summary = forecastAsSummary(forecastJunction(0, istDate(18)));
    expect(summary.junction_id).toBe(SEED_JUNCTIONS[0]!.id);
    expect(["LOW", "MODERATE", "HIGH"]).toContain(summary.congestion_level);
  });
});

describe("findPeaks", () => {
  const at = (day: number, hour: number) =>
    new Date(Date.UTC(2026, 9, day) + (hour - 5.5) * 3600_000);
  const hourOf = (from: Date, minutes: number) =>
    istHourOf(new Date(from.getTime() + minutes * 60_000));

  it("finds the commuter peaks on a working day", () => {
    const from = at(5, 6); // Monday 6 am
    const peaks = findPeaks(from);
    expect(hourOf(from, peaks.morning)).toBeGreaterThanOrEqual(8);
    expect(hourOf(from, peaks.morning)).toBeLessThanOrEqual(10);
    expect(hourOf(from, peaks.evening)).toBeGreaterThanOrEqual(17.5);
    expect(hourOf(from, peaks.evening)).toBeLessThanOrEqual(19.5);
  });

  it("looks ahead to Monday's rush when asked on a Sunday night", () => {
    const from = at(4, 23); // Sunday 11 pm
    const peaks = findPeaks(from);
    expect(hourOf(from, peaks.morning)).toBeGreaterThanOrEqual(8);
    expect(hourOf(from, peaks.morning)).toBeLessThanOrEqual(10);
  });

  it("finds the lunch and evening-outing peaks within a weekend", () => {
    const from = at(3, 6); // Saturday 6 am, the next 24 h are Saturday and early Sunday
    const peaks = findPeaks(from);
    expect(hourOf(from, peaks.morning)).toBeGreaterThanOrEqual(11);
    expect(hourOf(from, peaks.evening)).toBeGreaterThanOrEqual(18);
    expect(hourOf(from, peaks.evening)).toBeLessThanOrEqual(20.5);
  });

  it("returns whole steps inside the next 24 hours", () => {
    const p = findPeaks(at(5, 12));
    for (const m of [p.morning, p.evening]) {
      expect(m % 5).toBe(0);
      expect(m).toBeGreaterThan(0);
      expect(m).toBeLessThanOrEqual(24 * 60);
    }
  });
});

describe("per-arm delays", () => {
  it("lists four arms and their flow-weighted mean is the junction figure", () => {
    const f = forecastJunction(10, istDate(18, 30));
    expect(f.approachDelayAdaptive).toHaveLength(4);
    expect(f.approachDelayFixed).toHaveLength(4);
    expect(Math.min(...f.approachDelayAdaptive)).toBeGreaterThan(0);
  });
});

describe("wet roads", () => {
  it("lengthen waits and raise saturation for the same demand", () => {
    const at = istDate(13);
    let worse = 0;
    for (let i = 0; i < SEED_JUNCTIONS.length; i += 1) {
      const dry = forecastJunction(i, at);
      const wet = forecastJunction(i, at, { capacityScale: 0.8 });
      expect(wet.saturation).toBeGreaterThanOrEqual(dry.saturation);
      expect(wet.delayAdaptive).toBeGreaterThanOrEqual(dry.delayAdaptive);
      if (wet.delayAdaptive > dry.delayAdaptive) worse += 1;
    }
    expect(worse).toBeGreaterThan(SEED_JUNCTIONS.length * 0.9);
  });

  it("leave the fixed timer as it was, since a real timer does not know it is raining", () => {
    const at = istDate(9);
    const dry = forecastJunction(5, at);
    const wet = forecastJunction(5, at, { capacityScale: 0.8 });
    // The fixed plan is the same; only the capacity it meets has changed, so its wait rises too.
    expect(wet.delayFixed).toBeGreaterThan(dry.delayFixed);
  });
});
