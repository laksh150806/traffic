/**
 * Real traffic speeds, as TomTom's flow tiles report them, and how they are turned into demand.
 * Nothing here touches the network: fetching and decoding live in flow-tiles.server.ts.
 *
 * What TomTom measures is how fast traffic is moving on a stretch of road compared with how fast it
 * moves when the road is empty. That is not a count of vehicles or a queue at a signal, so it is
 * used to set how heavy the demand on a junction is, and the queues and signal plans are still
 * computed from that by the model.
 */

/** Zoom level of the flow tiles read. At 12 a tile is about 10 km across. */
export const FLOW_ZOOM = 12;

export type TileId = { x: number; y: number };

export function tileOf(lat: number, lng: number, zoom = FLOW_ZOOM): TileId {
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

const MIN_TILE_ZOOM = 6;
const MAX_TILE_ZOOM = 18;

/** A map tile address from a URL, as whole numbers inside the range that zoom level has, or null. */
export function parseTile(z: string, x: string, y: string) {
  if (![z, x, y].every((v) => /^[0-9]{1,8}$/.test(v))) return null;
  const zoom = Number(z);
  if (zoom < MIN_TILE_ZOOM || zoom > MAX_TILE_ZOOM) return null;
  const limit = 2 ** zoom;
  const tx = Number(x);
  const ty = Number(y);
  return tx < limit && ty < limit ? { z: zoom, x: tx, y: ty } : null;
}

/** Metres per degree of latitude; longitude shrinks with the cosine of the latitude. */
const M_PER_DEG = 111_320;

/**
 * Every tile needed to see the roads around these points: the tile each point is in, and the
 * neighbours when a point is within `marginM` of a tile's edge.
 */
export function tilesFor(
  points: ReadonlyArray<{ lat: number; lng: number }>,
  marginM = 300,
  zoom = FLOW_ZOOM,
): TileId[] {
  const seen = new Map<string, TileId>();
  for (const p of points) {
    const dLat = marginM / M_PER_DEG;
    const dLng = marginM / (M_PER_DEG * Math.cos((p.lat * Math.PI) / 180));
    for (const [la, ln] of [
      [0, 0],
      [dLat, dLng],
      [dLat, -dLng],
      [-dLat, dLng],
      [-dLat, -dLng],
    ] as const) {
      const t = tileOf(p.lat + la, p.lng + ln, zoom);
      seen.set(`${t.x}/${t.y}`, t);
    }
  }
  return [...seen.values()];
}

/** One stretch of road in a flow tile. */
export type FlowSegment = {
  /** Current speed over free-flow speed: 1 is moving freely, near 0 is at a standstill. */
  ratio: number;
  /** The road as [lng, lat] points. */
  line: Array<[number, number]>;
  roadType: string;
};

/** Metres from a point to a polyline, on the flat-earth scale that is exact enough at city size. */
export function distanceToLineM(lat: number, lng: number, line: Array<[number, number]>) {
  const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const ky = M_PER_DEG;
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, ay] = line[i] as [number, number];
    const [bx, by] = line[i + 1] as [number, number];
    const px = (lng - ax) * kx;
    const py = (lat - ay) * ky;
    const sx = (bx - ax) * kx;
    const sy = (by - ay) * ky;
    const len2 = sx * sx + sy * sy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * sx + py * sy) / len2));
    best = Math.min(best, Math.hypot(px - t * sx, py - t * sy));
  }
  return best;
}

export type JunctionFlow = {
  id: number;
  /** Current over free-flow speed around the junction, or null when no road was found near it. */
  ratio: number | null;
  /** How many road segments it is based on. */
  samples: number;
  /** Distance to the nearest of them, metres. */
  nearestM: number | null;
};

/** Roads this close to a junction count as its approaches. */
export const NEAR_M = 120;
/** With nothing that close, roads up to this far are used, with the distance reported. */
export const FAR_M = 250;

/**
 * The traffic speed around one junction: the average over the road segments close to it, nearer
 * ones counting for more. A segment with no reading (TomTom marks those 0) is ignored.
 */
export function junctionFlow(
  id: number,
  lat: number,
  lng: number,
  segments: readonly FlowSegment[],
): JunctionFlow {
  const near: Array<{ ratio: number; d: number }> = [];
  for (const s of segments) {
    if (!(s.ratio > 0)) continue;
    const d = distanceToLineM(lat, lng, s.line);
    if (d <= FAR_M) near.push({ ratio: s.ratio, d });
  }
  const close = near.filter((n) => n.d <= NEAR_M);
  const used = close.length > 0 ? close : near;
  if (used.length === 0) return { id, ratio: null, samples: 0, nearestM: null };
  let weight = 0;
  let sum = 0;
  for (const u of used) {
    const w = 1 / (u.d + 20);
    weight += w;
    sum += w * u.ratio;
  }
  return {
    id,
    ratio: Number((sum / weight).toFixed(3)),
    samples: used.length,
    nearestM: Math.round(Math.min(...used.map((u) => u.d))),
  };
}

export type TrafficSnapshot = {
  /** False when the server has no TomTom key, so there is nothing real to show. */
  enabled: boolean;
  fetchedAtMs: number;
  source: "tomtom";
  tilesOk: number;
  tilesTotal: number;
  junctions: JunctionFlow[];
};

/**
 * Volume over capacity implied by a speed ratio, by inverting the Bureau of Public Roads delay
 * curve (travel time grows as 1 + 0.15 (v/c)^4), the standard link-speed model of planning
 * software. A road moving at 80 % of free-flow speed is running at about 1.1 of its capacity, at
 * 50 % at about 1.6. It is a planning rule of thumb for a road link, not a measurement of a signal.
 */
export const BPR_ALPHA = 0.15;
export const BPR_BETA = 4;
const MIN_VC = 0.25;
const MAX_VC = 1.6;

/**
 * Above this speed ratio a road is effectively free flowing. The delay curve is almost flat there
 * (99 % of free-flow speed fits anything from half to three quarters of capacity), so the speed
 * cannot say how empty the road is, only that it is not near capacity.
 */
export const FREE_FLOW_RATIO = 0.95;
/** Volume over capacity a free-flowing road is taken to be at most. */
export const FREE_FLOW_CEILING_VC = 0.75;

export function volumeToCapacity(speedRatio: number): number {
  const r = Math.min(1, Math.max(0.2, speedRatio));
  const x = Math.pow((1 / r - 1) / BPR_ALPHA, 1 / BPR_BETA);
  return Math.min(MAX_VC, Math.max(MIN_VC, x));
}
