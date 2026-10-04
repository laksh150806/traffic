/**
 * Moves a junction onto the real traffic signal OpenStreetMap has nearest to it. The seed gives each
 * junction an approximate position (the median is several hundred metres from a mapped signal), and
 * everything that follows the road network, such as live traffic and route matching, is only as good
 * as that position.
 */
import osm from "@/lib/osm-signals.json";

const SIGNALS = osm.signals as unknown as ReadonlyArray<readonly [number, number]>;

/** A signal further than this from the seed point is not taken to be the same junction. */
export const SNAP_MAX_M = 450;

const EARTH_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

export type Snap = { lat: number; lng: number; offsetM: number; verified: boolean };

/**
 * The nearest mapped signal when one lies within SNAP_MAX_M, otherwise the original point flagged
 * unverified, with how far the nearest signal was.
 */
export function snapToSignal(
  lat: number,
  lng: number,
  signals: ReadonlyArray<readonly [number, number]> = SIGNALS,
  maxM = SNAP_MAX_M,
): Snap {
  let best = Infinity;
  let at: readonly [number, number] | null = null;
  for (const signal of signals) {
    const d = metres(lat, lng, signal[0], signal[1]);
    if (d < best) {
      best = d;
      at = signal;
    }
  }
  if (at && best <= maxM) {
    return { lat: at[0], lng: at[1], offsetM: Math.round(best), verified: true };
  }
  return { lat, lng, offsetM: Number.isFinite(best) ? Math.round(best) : -1, verified: false };
}
