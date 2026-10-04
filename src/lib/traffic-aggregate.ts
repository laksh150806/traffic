/**
 * Pure aggregation helpers used by both the Supabase data layer and the simulation
 * engine, so the dashboard numbers are computed the same way in either mode.
 */
import { FIXED_GREEN } from "@/lib/traffic-model";
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
    point.fixed_sec += Number(row.baseline_fixed_sec ?? FIXED_GREEN);
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
  junction_id?: number | null;
  arrival_rate_vph: number | null;
  degree_saturation: number | null;
  predicted_delay_adaptive_sec: number | null;
  predicted_delay_fixed_sec: number | null;
};

const mean = (values: number[]) =>
  values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

/**
 * Forecast accuracy plus flow-weighted network delay, from raw rows.
 * `baselineErrors` are the errors of the naive "queue stays as it is" guess over
 * the same samples, so the model's error has something to be compared with.
 */
export function computeModelPerformance(
  absErrors: number[],
  states: ModelStateSlice[],
  baselineErrors: number[] = [],
): ModelPerformance {
  const samples = absErrors.length;
  const meanAbsError = mean(absErrors);
  const hitRate = samples > 0 ? absErrors.filter((e) => e <= 3).length / samples : 0;

  let flow = 0;
  let adaptive = 0;
  let fixed = 0;
  let saturated = 0;
  const perJunction = new Map<number, { flow: number; adaptive: number; fixed: number }>();
  for (const row of states) {
    const w = Number(row.arrival_rate_vph ?? 0);
    const a = Number(row.predicted_delay_adaptive_sec ?? 0) * w;
    const f = Number(row.predicted_delay_fixed_sec ?? 0) * w;
    flow += w;
    adaptive += a;
    fixed += f;
    if (Number(row.degree_saturation ?? 0) > 1) saturated += 1;
    if (row.junction_id !== null && row.junction_id !== undefined) {
      const j = perJunction.get(row.junction_id) ?? { flow: 0, adaptive: 0, fixed: 0 };
      j.flow += w;
      j.adaptive += a;
      j.fixed += f;
      perJunction.set(row.junction_id, j);
    }
  }
  let worse = 0;
  for (const j of perJunction.values()) {
    if (j.flow > 0 && j.adaptive / j.flow > j.fixed / j.flow + 0.5) worse += 1;
  }

  return {
    meanAbsError: Number(meanAbsError.toFixed(2)),
    hitRate: Number(hitRate.toFixed(3)),
    samples,
    networkDelayAdaptive: Number((flow > 0 ? adaptive / flow : 0).toFixed(1)),
    networkDelayFixed: Number((flow > 0 ? fixed / flow : 0).toFixed(1)),
    saturatedApproaches: saturated,
    baselineMeanAbsError: Number(mean(baselineErrors).toFixed(2)),
    junctionsAdaptiveWorse: worse,
    junctionsTotal: perJunction.size,
  };
}
