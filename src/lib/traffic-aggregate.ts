/**
 * Pure aggregation helpers used by both the Supabase data layer and the demo
 * engine, so the dashboard numbers are computed the same way in either mode.
 */
import type { CyclePoint, ModelPerformance } from "@/lib/traffic-types";

export const DIRECTION_ORDER = ["NORTH", "EAST", "SOUTH", "WEST"];

export function directionRank(direction: string) {
  return DIRECTION_ORDER.indexOf(direction);
}

export type CycleRow = {
  cycle_number: number | null;
  allocated_green_sec: number | null;
  baseline_fixed_sec: number | null;
  estimated_wait_saved_sec: number | null;
  predicted_delay_adaptive_sec: number | null;
  predicted_delay_fixed_sec: number | null;
};

/** Collapse per-approach history rows into one point per signal cycle (last 15). */
export function aggregateCycleRows(rows: CycleRow[]): CyclePoint[] {
  const byCycle = new Map<number, CyclePoint & { n: number }>();
  for (const row of rows) {
    const cycle = Number(row.cycle_number ?? 0);
    const point = byCycle.get(cycle) ?? {
      cycle_number: cycle,
      adaptive_sec: 0,
      fixed_sec: 0,
      saved_sec: 0,
      delay_adaptive: 0,
      delay_fixed: 0,
      n: 0,
    };
    point.adaptive_sec += Number(row.allocated_green_sec ?? 0);
    point.fixed_sec += Number(row.baseline_fixed_sec ?? 30);
    point.saved_sec += Number(row.estimated_wait_saved_sec ?? 0);
    point.delay_adaptive += Number(row.predicted_delay_adaptive_sec ?? 0);
    point.delay_fixed += Number(row.predicted_delay_fixed_sec ?? 0);
    point.n += 1;
    byCycle.set(cycle, point);
  }

  return Array.from(byCycle.values())
    .sort((a, b) => a.cycle_number - b.cycle_number)
    .slice(-15)
    .map(({ n, ...point }) => ({
      ...point,
      delay_adaptive: Number((point.delay_adaptive / Math.max(n, 1)).toFixed(1)),
      delay_fixed: Number((point.delay_fixed / Math.max(n, 1)).toFixed(1)),
    }));
}

export type ModelStateSlice = {
  arrival_rate_vph: number | null;
  degree_saturation: number | null;
  predicted_delay_adaptive_sec: number | null;
  predicted_delay_fixed_sec: number | null;
};

/** Forecast accuracy plus flow-weighted network delay, from raw rows. */
export function computeModelPerformance(
  absErrors: number[],
  states: ModelStateSlice[],
): ModelPerformance {
  const samples = absErrors.length;
  const meanAbsError = samples > 0 ? absErrors.reduce((a, b) => a + b, 0) / samples : 0;
  const hitRate = samples > 0 ? absErrors.filter((e) => e <= 3).length / samples : 0;

  let flow = 0;
  let adaptive = 0;
  let fixed = 0;
  let saturated = 0;
  for (const row of states) {
    const w = Number(row.arrival_rate_vph ?? 0);
    flow += w;
    adaptive += Number(row.predicted_delay_adaptive_sec ?? 0) * w;
    fixed += Number(row.predicted_delay_fixed_sec ?? 0) * w;
    if (Number(row.degree_saturation ?? 0) > 1) saturated += 1;
  }

  return {
    meanAbsError: Number(meanAbsError.toFixed(2)),
    hitRate: Number(hitRate.toFixed(3)),
    samples,
    networkDelayAdaptive: Number((flow > 0 ? adaptive / flow : 0).toFixed(1)),
    networkDelayFixed: Number((flow > 0 ? fixed / flow : 0).toFixed(1)),
    saturatedApproaches: saturated,
  };
}
