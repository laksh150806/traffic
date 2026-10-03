/**
 * Steady-state forecast of how each junction behaves at a given time of day.
 * It reuses the same demand rule and Webster solver as the live simulator but
 * leaves out noise and carried-over queues, so any hour can be asked for
 * without running the simulation forward.
 */
import { fixedPlanForJunction, roadIdFor } from "@/lib/fixed-plan";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import {
  APPROACHES_PER_JUNCTION,
  INCIDENT_CAPACITY_FACTOR,
  approachDemandVph,
  incidentRoadId,
  levelFor,
  timeOfDayFactor,
} from "@/lib/sim-core";
import { FIXED_GREEN, solveJunction, type ApproachInput } from "@/lib/traffic-model";
import type { ApproachModelState, CongestionLevel, JunctionSummary } from "@/lib/traffic-types";

export { APPROACHES_PER_JUNCTION, roadIdFor };

export type JunctionForecast = {
  junctionId: number;
  /** Mean degree of saturation of the four approaches under the adaptive plan. */
  saturation: number;
  level: CongestionLevel;
  /** Average vehicles queued per approach, from Little's law (arrival rate x delay). */
  queue: number;
  /** Longest single-approach queue, vehicles. */
  maxQueue: number;
  /** Expected queue on each approach, in the order north, south, east, west. */
  approachQueues: number[];
  /** Total arrival rate over the four approaches, veh/h. */
  flowVph: number;
  /** Flow-weighted wait per vehicle, seconds. */
  delayAdaptive: number;
  delayFixed: number;
  cycle: number;
  /** True when at least one approach cannot clear its queue. */
  overCapacity: boolean;
};

/** What the forecast should assume beyond the clock: a scenario and blocked lanes. */
export type ForecastOptions = {
  /** Demand multiplier to use instead of the time-of-day curve (scenario mode). */
  factor?: number;
  /** Junction ids with a blocked lane. */
  incidents?: ReadonlySet<number>;
};

const WINDOW_SEC = 12;
const QUEUE_CAP = 60;

export function forecastJunction(
  index: number,
  at: Date,
  options: ForecastOptions = {},
): JunctionForecast {
  const seed = SEED_JUNCTIONS[index];
  if (!seed) throw new RangeError(`No junction at index ${index}`);

  const factor = options.factor ?? timeOfDayFactor(at);
  const blockedRoad = options.incidents?.has(seed.id) ? incidentRoadId(index) : null;

  const inputs: ApproachInput[] = Array.from({ length: APPROACHES_PER_JUNCTION }, (_, a) => {
    const roadId = roadIdFor(index, a);
    const demandVph = approachDemandVph({ roadId, maxCapacity: seed.capacity, factor });
    return {
      roadId,
      queue: 0,
      previousQueue: null,
      previousGreen: FIXED_GREEN,
      previousArrivalRate: null,
      measuredArrivals: (demandVph / 3600) * WINDOW_SEC,
      maxCapacity: seed.capacity,
      capacityFactor: roadId === blockedRoad ? INCIDENT_CAPACITY_FACTOR : 1,
    };
  });

  const model = solveJunction(inputs, WINDOW_SEC, fixedPlanForJunction(seed.id));
  const saturation =
    model.approaches.reduce((sum, a) => sum + a.degreeSaturation, 0) / model.approaches.length;
  const queues = model.approaches.map((a) =>
    Math.min(QUEUE_CAP, (a.arrivalRateVph / 3600) * a.delayAdaptive),
  );
  const queue = queues.reduce((sum, q) => sum + q, 0) / queues.length;
  const maxQueue = Math.max(...queues);

  return {
    junctionId: seed.id,
    saturation: Number(saturation.toFixed(3)),
    level: levelFor(saturation, maxQueue),
    queue: Number(queue.toFixed(1)),
    maxQueue: Number(maxQueue.toFixed(1)),
    approachQueues: queues.map((q) => Number(q.toFixed(2))),
    flowVph: model.approaches.reduce((sum, a) => sum + a.arrivalRateVph, 0),
    delayAdaptive: model.delayAdaptive,
    delayFixed: model.delayFixed,
    cycle: model.cycleLength,
    overCapacity: model.approaches.some((a) => !a.queueClears && a.degreeSaturation > 1),
  };
}

/**
 * The same figures for the present moment, read from the live model rows instead of
 * the steady-state formula, so a card can show one consistent set of numbers.
 */
export function liveAsForecast(
  summary: JunctionSummary,
  model: ApproachModelState[],
): JunctionForecast | undefined {
  if (model.length === 0) return undefined;
  const flow = model.reduce((sum, a) => sum + a.arrival_rate_vph, 0);
  const weighted = (pick: (a: ApproachModelState) => number) =>
    flow > 0 ? model.reduce((sum, a) => sum + pick(a) * a.arrival_rate_vph, 0) / flow : 0;
  const queues = model.map((a) => a.queue_now);
  return {
    junctionId: summary.junction_id,
    saturation: Number(
      (model.reduce((sum, a) => sum + a.degree_saturation, 0) / model.length).toFixed(3),
    ),
    level: summary.congestion_level,
    queue: Number((queues.reduce((a, b) => a + b, 0) / queues.length).toFixed(1)),
    maxQueue: Math.max(...queues),
    approachQueues: queues,
    flowVph: flow,
    delayAdaptive: Number(weighted((a) => a.predicted_delay_adaptive_sec).toFixed(1)),
    delayFixed: Number(weighted((a) => a.predicted_delay_fixed_sec).toFixed(1)),
    cycle: model[0]?.cycle_length_sec ?? 0,
    overCapacity: model.some((a) => !a.queue_clears && a.degree_saturation > 1),
  };
}

/** Forecast every junction. */
export function forecastNetwork(at: Date, options: ForecastOptions = {}) {
  return SEED_JUNCTIONS.map((_, index) => forecastJunction(index, at, options));
}

/** Same shape the data layer returns, so the map and lists can show a forecast unchanged. */
export function forecastAsSummary(forecast: JunctionForecast): JunctionSummary {
  const seed = SEED_JUNCTIONS.find((j) => j.id === forecast.junctionId);
  if (!seed) throw new RangeError(`Unknown junction ${forecast.junctionId}`);
  const queue = forecast.queue;
  return {
    junction_id: seed.id,
    name: seed.name,
    zone: seed.zone,
    latitude: seed.lat,
    longitude: seed.lng,
    avg_vehicle_count: queue,
    total_vehicle_count: Math.round(queue * APPROACHES_PER_JUNCTION),
    congestion_level: forecast.level,
    last_reading_at: null,
  };
}

/** A Date whose Chennai wall clock reads `hour:minute` (IST is UTC+5:30, no daylight saving). */
export function istDate(hour: number, minute = 0) {
  return new Date(Date.UTC(2026, 0, 5, hour, minute) - 5.5 * 3600 * 1000);
}

/** One value per hour of the day for a junction: the shape of a typical day. */
export function dayProfile(index: number) {
  return Array.from({ length: 24 }, (_, hour) => {
    const f = forecastJunction(index, istDate(hour));
    return { hour, saturation: f.saturation, level: f.level, queue: f.queue };
  });
}

/** Chennai wall-clock hour (0-23.99) for any instant. */
export function istHourOf(date: Date) {
  return (date.getUTCHours() + 5.5 + date.getUTCMinutes() / 60) % 24;
}

/** Minutes from `now` until the next time the Chennai clock reads `hour`, in whole steps. */
export function minutesUntilIst(now: Date, hour: number, stepMin = 5) {
  const current = istHourOf(now) * 60;
  const diff = hour * 60 - current;
  return Math.round((diff <= 0 ? diff + 24 * 60 : diff) / stepMin) * stepMin;
}

/** "today" or "tomorrow" on the Chennai calendar, for a moment `at` seen from `now`. */
export function dayLabel(now: Date, at: Date) {
  const day = (d: Date) => Math.floor((d.getTime() + 5.5 * 3600_000) / 86_400_000);
  return day(at) > day(now) ? "tomorrow" : "today";
}

export function formatIstTime(date: Date) {
  const minutes = Math.round(istHourOf(date) * 60) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "pm" : "am";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}
