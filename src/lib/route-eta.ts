/**
 * TomTom's own estimate of a trip with today's traffic in it, kept beside the model's so the two can
 * be compared. Pure helpers only: the request is made by the server route /api/route-eta.
 */

export type LiveEta = {
  lengthM: number;
  /** Driving time with the traffic there is now, seconds. */
  travelSec: number;
  /** The same trip on an empty road, seconds. */
  freeFlowSec: number;
  /** What current traffic adds, seconds. */
  delaySec: number;
  fetchedAtMs: number;
};

/** Chennai and its surroundings: anything outside is not a trip this app prices. */
const BOUNDS = { south: 12.5, north: 13.5, west: 79.8, east: 80.6 };

/** "lat,lng" from a URL, or null when it is not a point inside the area the app covers. */
export function parsePoint(text: string | null): { lat: number; lng: number } | null {
  if (!text) return null;
  const match = /^(-?[0-9]{1,3}(?:\.[0-9]{1,7})?),(-?[0-9]{1,3}(?:\.[0-9]{1,7})?)$/.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return lat >= BOUNDS.south && lat <= BOUNDS.north && lng >= BOUNDS.west && lng <= BOUNDS.east
    ? { lat, lng }
    : null;
}

type TomTomRoute = {
  routes?: Array<{
    summary?: {
      lengthInMeters?: number;
      travelTimeInSeconds?: number;
      noTrafficTravelTimeInSeconds?: number;
      trafficDelayInSeconds?: number;
    };
  }>;
};

/** The first route of a TomTom routing reply as a LiveEta, or null if it has no usable summary. */
export function parseTomTomRoute(body: unknown, fetchedAtMs: number): LiveEta | null {
  const summary = (body as TomTomRoute | null)?.routes?.[0]?.summary;
  if (
    !summary ||
    typeof summary.lengthInMeters !== "number" ||
    typeof summary.travelTimeInSeconds !== "number"
  ) {
    return null;
  }
  const freeFlow = summary.noTrafficTravelTimeInSeconds ?? summary.travelTimeInSeconds;
  return {
    lengthM: summary.lengthInMeters,
    travelSec: summary.travelTimeInSeconds,
    freeFlowSec: freeFlow,
    delaySec: Math.max(0, summary.trafficDelayInSeconds ?? summary.travelTimeInSeconds - freeFlow),
    fetchedAtMs,
  };
}
