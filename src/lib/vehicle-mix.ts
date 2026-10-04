/**
 * What a queue is made of. Chennai traffic is mostly two-wheelers, with cars, auto-rickshaws, buses
 * and trucks; a queue of 40 vehicles is therefore much shorter, and clears faster, than 40 cars.
 *
 * The shares, the car-equivalent factors and the road space each class takes are assumptions in the
 * range Indian traffic-engineering practice (the IRC passenger-car-unit tables) gives. They are not
 * counts from Chennai: the public count datasets checked (docs/DATA.md) are not from India, so
 * nothing here is fitted. Change the numbers below and everything that uses them follows.
 */

export type VehicleClass = "twoWheeler" | "car" | "auto" | "bus" | "truck";

export const CLASSES: ReadonlyArray<{
  id: VehicleClass;
  label: string;
  /** Share of vehicles on a typical Chennai approach. */
  share: number;
  /** How many passenger cars it counts as when working out how much of a road it uses. */
  pcu: number;
  /** Road length it takes up in a standing queue, with the gap to the next vehicle, metres. */
  spaceM: number;
}> = [
  { id: "twoWheeler", label: "Two-wheelers", share: 0.58, pcu: 0.5, spaceM: 2.0 },
  { id: "car", label: "Cars", share: 0.24, pcu: 1.0, spaceM: 6.0 },
  { id: "auto", label: "Auto-rickshaws", share: 0.09, pcu: 1.2, spaceM: 4.0 },
  { id: "bus", label: "Buses", share: 0.03, pcu: 3.0, spaceM: 12.0 },
  { id: "truck", label: "Trucks and vans", share: 0.06, pcu: 3.0, spaceM: 11.0 },
];

const weighted = (pick: (c: (typeof CLASSES)[number]) => number) =>
  CLASSES.reduce((sum, c) => sum + c.share * pick(c), 0) /
  CLASSES.reduce((sum, c) => sum + c.share, 0);

/** Passenger-car units one average vehicle counts as. */
export const AVG_PCU = weighted((c) => c.pcu);
/** Road length one average queued vehicle takes up, metres. */
export const AVG_SPACE_M = weighted((c) => c.spaceM);

/** Lanes a queue is taken to spread over on one approach (mapped lane counts are too patchy to use). */
export const ASSUMED_LANES = 2;
/**
 * Two-wheelers filter between the cars and queue several abreast, so a lane holds more of them
 * than its width suggests. This is the extra share of lane capacity they add.
 */
const FILTERING_GAIN = 0.25;

/** How long a standing queue of this many vehicles is, metres. */
export function queueLengthM(vehicles: number, lanes = ASSUMED_LANES): number {
  if (vehicles <= 0) return 0;
  const twoWheelerShare = CLASSES.find((c) => c.id === "twoWheeler")?.share ?? 0;
  const effectiveLanes = Math.max(1, lanes) * (1 + FILTERING_GAIN * twoWheelerShare);
  return (vehicles * AVG_SPACE_M) / effectiveLanes;
}

/** The same queue measured in passenger-car units. */
export function carEquivalents(vehicles: number): number {
  return Math.max(0, vehicles) * AVG_PCU;
}
