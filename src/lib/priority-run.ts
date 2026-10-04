/**
 * Priority runs: an ambulance, or a platoon of ordinary vehicles, that the signals along a route
 * turn green for one after another. This file holds the parts that need no engine state: the
 * settings of each kind, the hospitals an ambulance can be sent to, picking out the signals on a
 * route, and projecting what a vehicle would meet if nothing were done for it.
 */
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import { MIN_PHASE_SEC } from "@/lib/sim-core";
import { LOST_TIME_PER_PHASE } from "@/lib/traffic-model";
import { junctionsAlongRoute, type LngLat, type RouteJunction } from "@/lib/routing";

export type RunKind = "ambulance" | "wave";

export type RunSettings = {
  label: string;
  /** How fast the vehicle moves along its route, metres per second. */
  speedMps: number;
  /** A junction starts handing over the green this many seconds before the vehicle arrives. */
  leadSec: number;
  /** The priority ends this far past the junction, metres. */
  clearM: number;
  /** The running green is never cut shorter than this, seconds. */
  minGreenSec: number;
};

export const RUN_SETTINGS: Record<RunKind, RunSettings> = {
  // About 80 km/h: fast, but a real ambulance in a city does not hold that for long either.
  ambulance: { label: "Ambulance", speedMps: 22, leadSec: 12, clearM: 40, minGreenSec: 5 },
  // 40 km/h, the speed a coordinated corridor is usually timed for.
  wave: {
    label: "Green wave",
    speedMps: 40 / 3.6,
    leadSec: 8,
    clearM: 25,
    minGreenSec: MIN_PHASE_SEC,
  },
};

export type Hospital = { id: string; name: string; lat: number; lng: number };

/** Approximate positions of large Chennai hospitals, for choosing where an ambulance is headed. */
export const HOSPITALS: Hospital[] = [
  { id: "rggh", name: "Rajiv Gandhi Government General Hospital", lat: 13.0817, lng: 80.2766 },
  { id: "stanley", name: "Government Stanley Hospital", lat: 13.1063, lng: 80.2858 },
  { id: "kilpauk", name: "Kilpauk Medical College Hospital", lat: 13.0788, lng: 80.2427 },
  { id: "apollo", name: "Apollo Hospitals, Greams Road", lat: 13.0612, lng: 80.2524 },
  { id: "miot", name: "MIOT International, Manapakkam", lat: 13.0206, lng: 80.1865 },
  { id: "srmc", name: "Sri Ramachandra Medical Centre, Porur", lat: 13.0369, lng: 80.1469 },
];

export type RunStop = {
  junctionId: number;
  name: string;
  /** The approach the vehicle waits on, which is the one that gets the green. */
  roadId: number;
  /** Metres from the start of the route. */
  alongM: number;
};

/** Signals this close to the road are cleared for a priority run (seed positions are approximate). */
export const RUN_SNAP_M = 300;

const SEED_POINTS = SEED_JUNCTIONS.map((j) => ({ id: j.id, name: j.name, lat: j.lat, lng: j.lng }));

/** The signals along a road that a priority run can clear, in driving order. */
export function stopsForRoute(coordinates: LngLat[]): RunStop[] {
  return runStops(junctionsAlongRoute(coordinates, SEED_POINTS, RUN_SNAP_M));
}

/**
 * The signals on a route that can be given priority. A junction where the route starts has no
 * approach to read a heading from, so it is left out: the vehicle is already past its stop line.
 */
export function runStops(junctions: RouteJunction[]): RunStop[] {
  const stops: RunStop[] = [];
  for (const junction of junctions) {
    if (junction.arm === null) continue;
    const index = SEED_JUNCTIONS.findIndex((seed) => seed.id === junction.junctionId);
    if (index < 0) continue;
    stops.push({
      junctionId: junction.junctionId,
      name: junction.name,
      roadId: index * 4 + junction.arm + 1,
      alongM: junction.alongM,
    });
  }
  return stops.sort((a, b) => a.alongM - b.alongM);
}

/** What one approach is doing now, as the engine reports it. */
export type SignalPlan = {
  isGreen: boolean;
  phaseStartMs: number;
  /** Seconds of green allocated to this approach. */
  greenSec: number;
  /** Seconds for every approach to have had its green once. */
  cycleSec: number;
};

export type Window = { startSec: number; endSec: number };

/**
 * The stretches of usable green this approach will show over the next `horizonSec`, as seconds
 * from `nowMs`, if every approach keeps its present share of the cycle. A projection: the
 * adaptive controller changes its plan as queues change, so only the nearest windows are firm.
 */
export function greenWindows(plan: SignalPlan, nowMs: number, horizonSec: number): Window[] {
  const cycle = Math.max(plan.cycleSec, plan.greenSec + 10);
  const redSec = Math.max(0, cycle - plan.greenSec);
  const sinceSec = (nowMs - plan.phaseStartMs) / 1000;
  // Seconds from now to when this approach's phase begins: it began a moment ago, or begins after
  // the other approaches have had their share.
  let phaseBegins = plan.isGreen ? -sinceSec : redSec - sinceSec;
  while (phaseBegins + plan.greenSec < 0) phaseBegins += cycle;
  const windows: Window[] = [];
  for (let at = phaseBegins; at < horizonSec; at += cycle) {
    // Nothing discharges during the first LOST_TIME_PER_PHASE seconds of a phase.
    windows.push({ startSec: at + LOST_TIME_PER_PHASE, endSec: at + plan.greenSec });
  }
  return windows;
}

export type ProjectedStop = {
  stop: RunStop;
  windows: Window[];
  /** When the vehicle reaches the stop line, seconds from the start. */
  arriveSec: number;
  /** Seconds it waits there (0 when it meets a green). */
  waitSec: number;
};

export type Projection = {
  rows: ProjectedStop[];
  /** Time and distance of the vehicle's track, for drawing. */
  track: Array<{ t: number; x: number }>;
  stopsMade: number;
  waitSec: number;
  horizonSec: number;
};

/**
 * Where a vehicle driving at `speedMps` would meet red if nothing were done for it, using each
 * signal's present plan. It follows the first few signals it reaches, up to `maxHorizonSec`
 * from now, and reports how far ahead that turned out to be.
 */
export function projectDrive(
  stops: RunStop[],
  plans: ReadonlyMap<number, SignalPlan>,
  nowMs: number,
  speedMps: number,
  maxHorizonSec = 900,
  maxRows = 6,
): Projection {
  const rows: ProjectedStop[] = [];
  const track: Array<{ t: number; x: number }> = [{ t: 0, x: 0 }];
  let t = 0;
  let x = 0;
  let stopsMade = 0;
  let waitSec = 0;
  for (const stop of stops) {
    const plan = plans.get(stop.roadId);
    if (!plan) continue;
    const arriveSec = t + (stop.alongM - x) / speedMps;
    if (arriveSec > maxHorizonSec || rows.length >= maxRows) break;
    const windows = greenWindows(plan, nowMs, maxHorizonSec * 3);
    const open = windows.find((w) => arriveSec >= w.startSec && arriveSec <= w.endSec);
    const next = open ? null : windows.find((w) => w.startSec > arriveSec);
    const wait = next ? next.startSec - arriveSec : 0;
    track.push({ t: arriveSec, x: stop.alongM });
    if (wait > 0) {
      track.push({ t: arriveSec + wait, x: stop.alongM });
      stopsMade += 1;
      waitSec += wait;
    }
    rows.push({ stop, windows: windows.filter((w) => w.endSec > 0), arriveSec, waitSec: wait });
    t = arriveSec + wait;
    x = stop.alongM;
  }
  // Wide enough to show the last signal reached and a little beyond it, never less than 4 minutes.
  const horizonSec = Math.min(maxHorizonSec, Math.max(240, Math.ceil((t + 60) / 60) * 60));
  return { rows, track, stopsMade, waitSec: Math.round(waitSec), horizonSec };
}
