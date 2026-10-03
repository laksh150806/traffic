/**
 * Steady-state forecast of how each junction behaves at a given time of day.
 * It reuses the same demand rule and Webster solver as the live simulator but
 * leaves out noise and carried-over queues, so any hour can be asked for
 * without running the simulation forward.
 */
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import { DEMAND_SCALE, levelFor, loadFor, timeOfDayFactor } from "@/lib/sim-core";
import {
  FIXED_GREEN,
  saturationFlow,
  solveJunction,
  type ApproachInput,
} from "@/lib/traffic-model";
import type { CongestionLevel, JunctionSummary } from "@/lib/traffic-types";

export const APPROACHES_PER_JUNCTION = 4;

/** Road ids follow the order the demo engine (and the seed migration) number them in. */
export function roadIdFor(junctionIndex: number, approachIndex: number) {
  return junctionIndex * APPROACHES_PER_JUNCTION + approachIndex + 1;
}

export type JunctionForecast = {
  junctionId: number;
  /** Mean degree of saturation of the four approaches under the adaptive plan. */
  saturation: number;
  level: CongestionLevel;
  /** Average vehicles queued per approach, from Little's law (arrival rate x delay). */
  queue: number;
  /** Flow-weighted wait per vehicle, seconds. */
  delayAdaptive: number;
  delayFixed: number;
  cycle: number;
  /** True when at least one approach cannot clear its queue. */
  overCapacity: boolean;
};

const WINDOW_SEC = 12;
const QUEUE_CAP = 60;

export function forecastJunction(index: number, at: Date, boost = 1): JunctionForecast {
  const seed = SEED_JUNCTIONS[index];
  if (!seed) throw new RangeError(`No junction at index ${index}`);

  const factor = timeOfDayFactor(at);
  const approachCapacity = saturationFlow(seed.capacity) / APPROACHES_PER_JUNCTION;

  const inputs: ApproachInput[] = Array.from({ length: APPROACHES_PER_JUNCTION }, (_, a) => {
    const roadId = roadIdFor(index, a);
    const demandVph = approachCapacity * DEMAND_SCALE * loadFor(roadId) * (factor / 1.15) * boost;
    return {
      roadId,
      queue: 0,
      previousQueue: null,
      previousGreen: FIXED_GREEN,
      previousArrivalRate: null,
      measuredArrivals: (demandVph / 3600) * WINDOW_SEC,
      maxCapacity: seed.capacity,
    };
  });

  const model = solveJunction(inputs, WINDOW_SEC);
  const saturation =
    model.approaches.reduce((sum, a) => sum + a.degreeSaturation, 0) / model.approaches.length;
  const queue =
    model.approaches.reduce(
      (sum, a) => sum + Math.min(QUEUE_CAP, (a.arrivalRateVph / 3600) * a.delayAdaptive),
      0,
    ) / model.approaches.length;

  return {
    junctionId: seed.id,
    saturation: Number(saturation.toFixed(3)),
    level: levelFor(saturation),
    queue: Number(queue.toFixed(1)),
    delayAdaptive: model.delayAdaptive,
    delayFixed: model.delayFixed,
    cycle: model.cycleLength,
    overCapacity: model.approaches.some((a) => !a.queueClears && a.degreeSaturation > 1),
  };
}

/** Forecast every junction. `boosts` maps junction id to a demand multiplier (incidents). */
export function forecastNetwork(at: Date, boosts: ReadonlyMap<number, number> = new Map()) {
  return SEED_JUNCTIONS.map((seed, index) => forecastJunction(index, at, boosts.get(seed.id) ?? 1));
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

export function formatIstTime(date: Date) {
  const minutes = Math.round(istHourOf(date) * 60) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "pm" : "am";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}
