import { describe, expect, it } from "vitest";
import { fixedPlanForJunction } from "@/lib/fixed-plan";
import {
  dayLabel,
  forecastJunction,
  istDate,
  liveAsForecast,
  minutesUntilIst,
} from "@/lib/forecast";
import { searchJunctions } from "@/lib/search";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import {
  aggregateCycleRows,
  computeModelPerformance,
  directionRank,
} from "@/lib/traffic-aggregate";
import {
  LOST_TIME_PER_PHASE,
  MAX_CYCLE,
  MAX_GREEN,
  MIN_CYCLE,
  MIN_GREEN,
} from "@/lib/traffic-model";
import type { ApproachModelState, JunctionSummary } from "@/lib/traffic-types";

const summary = (id: number, name: string, zone: string): JunctionSummary => ({
  junction_id: id,
  name,
  zone,
  latitude: 13,
  longitude: 80,
  avg_vehicle_count: 10,
  total_vehicle_count: 40,
  congestion_level: "LOW",
  last_reading_at: null,
});

describe("searchJunctions", () => {
  const list = [
    summary(1, "Guindy Signal", "Central"),
    summary(2, "Kathipara Junction", "Central"),
    summary(3, "Egmore Station Junction", "Central"),
    summary(4, "Tambaram Junction", "GST Corridor"),
  ];

  it("returns nothing for an empty query", () => {
    expect(searchJunctions(list, "")).toEqual([]);
    expect(searchJunctions(list, "   ")).toEqual([]);
  });

  it("ranks a name that starts with the query above one that merely contains it", () => {
    const found = searchJunctions(list, "g");
    expect(found[0]?.name).toBe("Guindy Signal");
  });

  it("matches the start of any word, and falls back to the zone", () => {
    expect(searchJunctions(list, "station").map((j) => j.junction_id)).toEqual([3]);
    expect(searchJunctions(list, "gst").map((j) => j.junction_id)).toEqual([4]);
  });

  it("is case-insensitive and respects the limit", () => {
    expect(searchJunctions(list, "JUNCTION", 2)).toHaveLength(2);
    expect(searchJunctions(list, "zzz")).toEqual([]);
  });
});

describe("time shortcuts", () => {
  it("counts minutes to the next time the Chennai clock reads an hour", () => {
    expect(minutesUntilIst(istDate(8, 0), 9)).toBe(60);
    expect(minutesUntilIst(istDate(8, 0), 8)).toBe(24 * 60);
    expect(minutesUntilIst(istDate(23, 30), 0)).toBe(30);
    expect(minutesUntilIst(istDate(17, 58), 18.5, 5)).toBe(30);
  });

  it("labels today and tomorrow on the Chennai calendar", () => {
    expect(dayLabel(istDate(10, 0), istDate(18, 30))).toBe("today");
    expect(dayLabel(istDate(23, 0), new Date(istDate(23, 0).getTime() + 3 * 3600_000))).toBe(
      "tomorrow",
    );
  });
});

describe("fixed timer baseline", () => {
  it("has a valid plan for every seeded junction", () => {
    for (const seed of SEED_JUNCTIONS) {
      const plan = fixedPlanForJunction(seed.id);
      expect(plan).toBeDefined();
      expect(plan!.greens).toHaveLength(4);
      expect(plan!.greens.reduce((a, b) => a + b, 0) + 4 * LOST_TIME_PER_PHASE).toBe(plan!.cycle);
      expect(plan!.cycle).toBeGreaterThanOrEqual(MIN_CYCLE);
      expect(plan!.cycle).toBeLessThanOrEqual(MAX_CYCLE);
      plan!.greens.forEach((g) => {
        expect(g).toBeGreaterThanOrEqual(MIN_GREEN);
        expect(g).toBeLessThanOrEqual(MAX_GREEN);
      });
    }
  });

  it("does not exist for an unknown junction, and is cached", () => {
    expect(fixedPlanForJunction(9999)).toBeUndefined();
    expect(fixedPlanForJunction(1)).toBe(fixedPlanForJunction(1));
  });

  it("is a plan for average traffic: neither the night nor the peak plan", () => {
    // With the same timer all day, the adaptive plan has to win by adapting, so it should
    // win clearly at the peak and by little overnight.
    const gain = (hour: number, minute = 0) => {
      let fixed = 0;
      let adaptive = 0;
      SEED_JUNCTIONS.forEach((_, i) => {
        const f = forecastJunction(i, istDate(hour, minute));
        fixed += f.delayFixed;
        adaptive += f.delayAdaptive;
      });
      return (fixed - adaptive) / fixed;
    };
    expect(gain(18, 30)).toBeGreaterThan(0.1);
    expect(gain(18, 30)).toBeGreaterThan(gain(3) + 0.05);
  });
});

describe("liveAsForecast", () => {
  const model = (road: number, over: Partial<ApproachModelState> = {}): ApproachModelState => ({
    road_id: road,
    direction: "NORTH",
    arrival_rate_vph: 400,
    saturation_flow_vph: 2000,
    degree_saturation: 0.8,
    green_sec: 30,
    cycle_length_sec: 100,
    queue_now: 10,
    predicted_queue_next: 10,
    predicted_delay_adaptive_sec: 20,
    predicted_delay_fixed_sec: 30,
    queue_clears: true,
    ...over,
  });

  it("has nothing to say without model rows", () => {
    expect(liveAsForecast(summary(1, "A", "Z"), [])).toBeUndefined();
  });

  it("weights the delays by arrival rate and keeps the live level", () => {
    const f = liveAsForecast(summary(1, "A", "Z"), [
      model(1, { arrival_rate_vph: 900, predicted_delay_adaptive_sec: 10 }),
      model(2, { arrival_rate_vph: 100, predicted_delay_adaptive_sec: 50 }),
    ])!;
    expect(f.delayAdaptive).toBeCloseTo(14, 1);
    expect(f.flowVph).toBe(1000);
    expect(f.level).toBe("LOW");
    expect(f.cycle).toBe(100);
  });

  it("puts the per-arm figures in the model's arm order, whatever order the rows arrive in", () => {
    // Rows arrive in display order: north, east, south, west.
    const f = liveAsForecast(summary(1, "A", "Z"), [
      model(1, { direction: "NORTH", queue_now: 1, predicted_delay_adaptive_sec: 11 }),
      model(3, { direction: "EAST", queue_now: 3, predicted_delay_adaptive_sec: 33 }),
      model(2, { direction: "SOUTH", queue_now: 2, predicted_delay_adaptive_sec: 22 }),
      model(4, { direction: "WEST", queue_now: 4, predicted_delay_adaptive_sec: 44 }),
    ])!;
    // Model order is north, south, east, west.
    expect(f.approachQueues).toEqual([1, 2, 3, 4]);
    expect(f.approachDelayAdaptive).toEqual([11, 22, 33, 44]);
  });

  it("reports the longest queue and over-capacity arms", () => {
    const f = liveAsForecast(summary(1, "A", "Z"), [
      model(1, { queue_now: 5 }),
      model(2, { queue_now: 70, degree_saturation: 1.4, queue_clears: false }),
    ])!;
    expect(f.maxQueue).toBe(70);
    expect(f.overCapacity).toBe(true);
  });
});

describe("traffic-aggregate", () => {
  it("collapses history rows into one point per cycle, newest 15, oldest first", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      cycle_number: Math.floor(i / 4),
      allocated_green_sec: 20,
      baseline_fixed_sec: 26,
      estimated_wait_saved_sec: -2,
      predicted_delay_adaptive_sec: 10,
      predicted_delay_fixed_sec: 14,
    }));
    const points = aggregateCycleRows(rows);
    expect(points).toHaveLength(10);
    expect(points[0]!.cycle_number).toBe(0);
    expect(points[0]!.adaptive_sec).toBe(80);
    expect(points[0]!.fixed_sec).toBe(104);
    expect(points[0]!.saved_sec).toBe(-8); // the sign survives
    expect(points[0]!.delay_adaptive).toBe(10); // delays are averaged, not summed
  });

  it("scores the model against the naive guess and counts worse junctions", () => {
    const state = (junction: number, adaptive: number, fixed: number) => ({
      junction_id: junction,
      arrival_rate_vph: 500,
      degree_saturation: 0.6,
      predicted_delay_adaptive_sec: adaptive,
      predicted_delay_fixed_sec: fixed,
    });
    const perf = computeModelPerformance(
      [0, 1, 4],
      [state(1, 10, 20), state(1, 10, 20), state(2, 30, 20), state(2, 30, 20)],
      [2, 2, 2],
    );
    expect(perf.samples).toBe(3);
    expect(perf.meanAbsError).toBeCloseTo(1.67, 2);
    expect(perf.baselineMeanAbsError).toBe(2);
    expect(perf.hitRate).toBeCloseTo(0.667, 2);
    expect(perf.junctionsTotal).toBe(2);
    expect(perf.junctionsAdaptiveWorse).toBe(1);
    expect(perf.networkDelayAdaptive).toBe(20);
    expect(perf.networkDelayFixed).toBe(20);
  });

  it("copes with no data", () => {
    const perf = computeModelPerformance([], []);
    expect(perf.samples).toBe(0);
    expect(perf.networkDelayFixed).toBe(0);
    expect(perf.junctionsTotal).toBe(0);
  });

  it("orders directions the way the junction is drawn", () => {
    const sorted = ["WEST", "NORTH", "SOUTH", "EAST"].sort(
      (a, b) => directionRank(a) - directionRank(b),
    );
    expect(sorted).toEqual(["NORTH", "EAST", "SOUTH", "WEST"]);
  });
});
