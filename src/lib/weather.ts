/**
 * Real weather for Chennai from Open-Meteo (free, no key), turned into the share of road capacity
 * that rain leaves. Wet roads slow traffic and widen gaps; the amounts are assumptions in the
 * range the Highway Capacity Manual gives, not measurements for Chennai.
 */
import { RAIN_CAPACITY_FACTOR } from "@/lib/sim-core";

/** Where in Chennai the weather is read: the middle of the network. */
export const WEATHER_POINT = { lat: 13.08, lng: 80.27 };

/** Hourly rain at or above this, mm, counts as steady rain. Below it but above dry is light rain. */
export const STEADY_RAIN_MM = 2.5;
export const DRY_MM = 0.1;
/** Share of capacity left in light rain (steady rain uses the heavy-rain figure). */
export const LIGHT_RAIN_CAPACITY_FACTOR = 0.92;

export type WeatherSnapshot = {
  fetchedAtMs: number;
  /** Conditions at `atMs`, the latest reading. */
  current: { atMs: number; precipMm: number; tempC: number };
  /** Rain in the hour ending at `atMs`, for the next two days. */
  hourly: Array<{ atMs: number; precipMm: number }>;
};

export type RainClass = "dry" | "light" | "steady";

export const rainClass = (mmPerHour: number): RainClass =>
  mmPerHour >= STEADY_RAIN_MM ? "steady" : mmPerHour >= DRY_MM ? "light" : "dry";

export const rainLabel = (mmPerHour: number) =>
  ({ dry: "Dry", light: "Light rain", steady: "Rain" })[rainClass(mmPerHour)];

/** Share of normal capacity left at this rainfall rate. */
export function capacityForRain(mmPerHour: number): number {
  const kind = rainClass(mmPerHour);
  return kind === "steady"
    ? RAIN_CAPACITY_FACTOR
    : kind === "light"
      ? LIGHT_RAIN_CAPACITY_FACTOR
      : 1;
}

type OpenMeteoResponse = {
  current?: { time?: number; temperature_2m?: number; precipitation?: number };
  hourly?: { time?: number[]; precipitation?: Array<number | null> };
};

/** Read an Open-Meteo reply fetched with `timeformat=unixtime`. Null when it is not usable. */
export function parseWeather(body: unknown, fetchedAtMs: number): WeatherSnapshot | null {
  const data = body as OpenMeteoResponse | null;
  const current = data?.current;
  const times = data?.hourly?.time;
  const rain = data?.hourly?.precipitation;
  if (
    !current ||
    typeof current.time !== "number" ||
    typeof current.precipitation !== "number" ||
    !times ||
    !rain
  ) {
    return null;
  }
  const hourly = times.flatMap((t, i) => {
    const mm = rain[i];
    return typeof t === "number" && typeof mm === "number"
      ? [{ atMs: t * 1000, precipMm: mm }]
      : [];
  });
  if (hourly.length === 0) return null;
  return {
    fetchedAtMs,
    current: {
      atMs: current.time * 1000,
      precipMm: current.precipitation,
      tempC: typeof current.temperature_2m === "number" ? current.temperature_2m : NaN,
    },
    hourly,
  };
}

const URL_BASE = "https://api.open-meteo.com/v1/forecast";

export async function fetchWeather(
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
  signal?: AbortSignal,
): Promise<WeatherSnapshot | null> {
  const query = new URLSearchParams({
    latitude: String(WEATHER_POINT.lat),
    longitude: String(WEATHER_POINT.lng),
    current: "temperature_2m,precipitation",
    hourly: "precipitation",
    forecast_days: "2",
    timeformat: "unixtime",
  });
  const response = await fetcher(`${URL_BASE}?${query}`, signal ? { signal } : undefined);
  if (!response.ok) return null;
  return parseWeather(await response.json(), nowMs);
}

let snapshot: WeatherSnapshot | null = null;

export const setWeather = (next: WeatherSnapshot | null) => {
  snapshot = next;
};
export const getWeather = () => snapshot;

/** The reading counts as "now" for this long after it was taken. */
const CURRENT_FRESH_MS = 40 * 60_000;

/** Rainfall rate in mm per hour expected at a moment, or null when there is no weather to go on. */
export function rainAt(ms: number): number | null {
  const w = snapshot;
  if (!w) return null;
  if (Math.abs(ms - w.current.atMs) <= CURRENT_FRESH_MS) return w.current.precipMm;
  // Each hourly value is the rain in the hour that ends at its time, so the first one at or after
  // this moment is the hour that contains it.
  const entry = w.hourly.find((h) => h.atMs >= ms);
  if (!entry || entry.atMs - ms > 3600_000) return null;
  return entry.precipMm;
}

/** Share of capacity real weather leaves at a moment; 1 when there is no weather information. */
export function weatherCapacityAt(ms: number): number {
  const mm = rainAt(ms);
  return mm === null ? 1 : capacityForRain(mm);
}
