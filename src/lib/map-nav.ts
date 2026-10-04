/**
 * Moving between junctions from the keyboard. The map draws its markers on a canvas, so they
 * cannot take focus one by one; instead, Shift plus an arrow key on the focused map jumps the
 * selection to the nearest junction in that direction.
 */
export type NavDirection = "up" | "down" | "left" | "right";

type Point = { junction_id: number; latitude: number; longitude: number };

const VECTOR: Record<NavDirection, readonly [x: number, y: number]> = {
  up: [0, 1],
  down: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};

/** Flat east/north offsets in kilometres, accurate enough across a city. */
function offsetKm(from: { latitude: number; longitude: number }, to: Point) {
  const lat = (from.latitude + to.latitude) / 2;
  return [
    (to.longitude - from.longitude) * 111.32 * Math.cos((lat * Math.PI) / 180),
    (to.latitude - from.latitude) * 110.57,
  ] as const;
}

/**
 * The junction to select when moving `direction` from `origin`. Candidates must lie within 60
 * degrees of that direction (any in the half-plane if none do), and the nearest wins, with a
 * penalty for being off to the side. Returns null when there is nothing that way.
 */
export function neighbourInDirection<T extends Point>(
  items: readonly T[],
  origin: { latitude: number; longitude: number; junction_id?: number },
  direction: NavDirection,
): T | null {
  const [dx, dy] = VECTOR[direction];
  let best: { item: T; score: number } | null = null;
  let bestWide: { item: T; score: number } | null = null;
  for (const item of items) {
    if (item.junction_id === origin.junction_id) continue;
    const [x, y] = offsetKm(origin, item);
    const dist = Math.hypot(x, y);
    if (dist < 1e-6) continue;
    const cos = (x * dx + y * dy) / dist;
    if (cos <= 0) continue;
    const score = dist * (1 + (1 - cos) * 2);
    if (cos >= 0.5 && (!best || score < best.score)) best = { item, score };
    if (!bestWide || score < bestWide.score) bestWide = { item, score };
  }
  return (best ?? bestWide)?.item ?? null;
}
