/**
 * Turning a drive from A to B into "how long will the signals cost me".
 * Road geometry and base driving time come from OSRM's public demo server (no key);
 * the signal delay at each junction the route crosses comes from the traffic model.
 * Pure helpers here, so the maths can be tested without a network.
 */
import type { JunctionForecast } from "@/lib/forecast";

export type LngLat = [number, number];

export type OsrmRoute = {
  /** Polyline as [lng, lat] pairs. */
  coordinates: LngLat[];
  distanceM: number;
  durationSec: number;
};

export type RouteJunction = {
  junctionId: number;
  name: string;
  /** Metres from the start of the route to the closest point to this junction. */
  alongM: number;
  /** How far the junction sits from the route line, metres. */
  offM: number;
};

export type RouteAssessment = {
  route: OsrmRoute;
  /** True when this is a straight-line estimate because routing was unreachable. */
  estimate: boolean;
  junctions: RouteJunction[];
  driveSec: number;
  signalAdaptiveSec: number;
  signalFixedSec: number;
  etaAdaptiveSec: number;
  etaFixedSec: number;
  /** Worst junction on the route, for the "watch out for" line. */
  worst: { junctionId: number; name: string; level: JunctionForecast["level"] } | null;
};

const EARTH_M = 6_371_000;
/** A junction counts as "on the route" if the line passes this close to it. */
export const ON_ROUTE_M = 200;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(a: LngLat, b: LngLat) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

/** Closest approach of point `p` to segment a-b in a local flat projection (fine at city scale). */
export function distanceToSegment(p: LngLat, a: LngLat, b: LngLat) {
  const lat0 = toRad((a[1] + b[1]) / 2);
  const kx = Math.cos(lat0) * ((Math.PI / 180) * EARTH_M);
  const ky = (Math.PI / 180) * EARTH_M;
  const ax = a[0] * kx;
  const ay = a[1] * ky;
  const bx = b[0] * kx - ax;
  const by = b[1] * ky - ay;
  const px = p[0] * kx - ax;
  const py = p[1] * ky - ay;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return { distance: Math.hypot(px - t * bx, py - t * by), t };
}

/** Junctions the route passes through, in driving order. */
export function junctionsAlongRoute(
  coordinates: LngLat[],
  junctions: Array<{ id: number; name: string; lat: number; lng: number }>,
  maxM = ON_ROUTE_M,
): RouteJunction[] {
  if (coordinates.length < 2) return [];

  const cumulative: number[] = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    cumulative.push(
      (cumulative[i - 1] ?? 0) + haversineM(coordinates[i - 1] as LngLat, coordinates[i] as LngLat),
    );
  }

  const found: RouteJunction[] = [];
  for (const junction of junctions) {
    const point: LngLat = [junction.lng, junction.lat];
    let best = { distance: Infinity, along: 0 };
    for (let i = 0; i < coordinates.length - 1; i += 1) {
      const a = coordinates[i] as LngLat;
      const b = coordinates[i + 1] as LngLat;
      const { distance, t } = distanceToSegment(point, a, b);
      if (distance < best.distance) {
        best = {
          distance,
          along: (cumulative[i] ?? 0) + t * ((cumulative[i + 1] ?? 0) - (cumulative[i] ?? 0)),
        };
      }
    }
    if (best.distance <= maxM) {
      found.push({
        junctionId: junction.id,
        name: junction.name,
        alongM: Math.round(best.along),
        offM: Math.round(best.distance),
      });
    }
  }
  return found.sort((x, y) => x.alongM - y.alongM);
}

const LEVEL_RANK = { LOW: 0, MODERATE: 1, HIGH: 2 } as const;

/** Adds the signal delay of every junction on the route to the base driving time. */
export function assessRoute(
  route: OsrmRoute,
  onRoute: RouteJunction[],
  forecast: ReadonlyMap<number, JunctionForecast>,
  estimate = false,
): RouteAssessment {
  let adaptive = 0;
  let fixed = 0;
  let worst: RouteAssessment["worst"] = null;
  let worstScore = -1;

  for (const stop of onRoute) {
    const f = forecast.get(stop.junctionId);
    if (!f) continue;
    adaptive += f.delayAdaptive;
    fixed += f.delayFixed;
    const score = LEVEL_RANK[f.level] * 10 + f.saturation;
    if (score > worstScore) {
      worstScore = score;
      worst = { junctionId: stop.junctionId, name: stop.name, level: f.level };
    }
  }

  return {
    route,
    estimate,
    junctions: onRoute,
    driveSec: Math.round(route.durationSec),
    signalAdaptiveSec: Math.round(adaptive),
    signalFixedSec: Math.round(fixed),
    etaAdaptiveSec: Math.round(route.durationSec + adaptive),
    etaFixedSec: Math.round(route.durationSec + fixed),
    worst,
  };
}

/** Fastest first, by adaptive-signal ETA. */
export function rankRoutes(assessments: RouteAssessment[]) {
  return [...assessments].sort((a, b) => a.etaAdaptiveSec - b.etaAdaptiveSec);
}

/** Used when the routing service cannot be reached: a straight line at a typical city speed. */
export function straightLineRoute(from: LngLat, to: LngLat): OsrmRoute {
  const distanceM = haversineM(from, to) * 1.35; // roads are rarely straight
  return { coordinates: [from, to], distanceM, durationSec: distanceM / (22 / 3.6) };
}

type OsrmResponse = {
  code: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry: { coordinates: LngLat[] };
  }>;
};

const OSRM = "https://router.project-osrm.org/route/v1/driving";

export async function fetchOsrmRoutes(
  from: LngLat,
  to: LngLat,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<OsrmRoute[]> {
  const url = `${OSRM}/${from[0]},${from[1]};${to[0]},${to[1]}?alternatives=true&overview=full&geometries=geojson`;
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Routing service answered ${response.status}`);
  const body = (await response.json()) as OsrmResponse;
  if (body.code !== "Ok" || !body.routes?.length) throw new Error(`No route found (${body.code})`);
  return body.routes.map((r) => ({
    coordinates: r.geometry.coordinates,
    distanceM: r.distance,
    durationSec: r.duration,
  }));
}

export function formatMinutes(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

export function formatKm(meters: number) {
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}
