/**
 * Lays the city's lat/lng box flat on a plane so the network can be drawn as a
 * 3D scene. Pure maths, no three.js. North is -Z, east is +X.
 */
export type GeoPoint = { lat: number; lng: number };

export type PlaneFrame = {
  midLat: number;
  midLng: number;
  /** Scene units per degree of map. */
  scale: number;
};

/** Frame that fits `points` inside a square of `size` scene units, keeping aspect. */
export function planeFrameFor(points: GeoPoint[], size = 7): PlaneFrame {
  if (points.length === 0) return { midLat: 0, midLng: 0, scale: 1 };
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const span = Math.max(maxLat - minLat, maxLng - minLng, 1e-6);
  return {
    midLat: (minLat + maxLat) / 2,
    midLng: (minLng + maxLng) / 2,
    scale: size / span,
  };
}

/** Scene [x, z] for a map point; the frame's centre lands on the origin. */
export function toPlane(point: GeoPoint, frame: PlaneFrame): [number, number] {
  return [(point.lng - frame.midLng) * frame.scale, -(point.lat - frame.midLat) * frame.scale];
}

/**
 * Link each point to its nearest neighbours so the junctions read as a network.
 * Returns unique index pairs; links longer than `maxLen` are dropped.
 */
export function nearestLinks(
  positions: Array<[number, number]>,
  perNode = 2,
  maxLen = Infinity,
): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  positions.forEach(([x, z], i) => {
    const near = positions
      .map(([ox, oz], j) => ({ j, d: Math.hypot(ox - x, oz - z) }))
      .filter((n) => n.j !== i && n.d <= maxLen)
      .sort((a, b) => a.d - b.d)
      .slice(0, perNode);
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(i < j ? [i, j] : [j, i]);
    }
  });
  return out;
}
