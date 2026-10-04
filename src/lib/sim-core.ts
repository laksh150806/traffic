/**
 * Pure simulation rules shared by the live backend (traffic.functions.ts) and
 * the in-browser demo engine, so both behave identically. No I/O in here.
 */
import { LOST_TIME_PER_PHASE, clamp, saturationFlow } from "@/lib/traffic-model";
import type { CongestionLevel } from "@/lib/traffic-types";

/** Every modelled junction is a four-way crossing. */
export const APPROACHES_PER_JUNCTION = 4;

/**
 * Deterministic per-road "personality": how heavily loaded this approach runs
 * relative to its own capacity (0.45 = under half, ~1.4 = well over).
 */
export function loadFor(roadId: number) {
  const seed = Math.sin(roadId * 12.9898) * 43758.5453;
  const frac = seed - Math.floor(seed);
  return 0.45 + frac * 0.95;
}

/** Queue length (vehicles) on a single arm at which the whole junction is no longer "free flowing". */
const QUEUE_BUSY = 40;
const QUEUE_JAMMED = 80;

/**
 * Traffic-light colour for a junction. The mean degree of saturation of its
 * approaches sets the base level; a long queue on any one arm raises it, so a
 * junction with a single jammed arm is never shown as free flowing.
 */
export function levelFor(avgSaturation: number, maxQueue = 0): CongestionLevel {
  if (avgSaturation >= 0.95 || maxQueue >= QUEUE_JAMMED) return "HIGH";
  if (avgSaturation >= 0.75 || maxQueue >= QUEUE_BUSY) return "MODERATE";
  return "LOW";
}

type Knots = ReadonlyArray<readonly [hour: number, factor: number]>;

/**
 * Chennai (UTC+5:30) demand shaping through a working day: plateaus at the morning
 * peak, midday, the evening peak and the evening shoulder, joined by ramps so
 * the demand never jumps between two consecutive minutes. Synthetic until it is
 * calibrated on counted data.
 */
const WEEKDAY_KNOTS: Knots = [
  [0, 0.45],
  [6.5, 0.45],
  [8, 1.75],
  [10, 1.75],
  [11, 1.15],
  [16, 1.15],
  [17.5, 1.9],
  [19.5, 1.9],
  [21, 0.9],
  [22, 0.9],
  [23.5, 0.45],
  [24, 0.45],
];

/**
 * Saturday and Sunday: no commuter peaks. Traffic builds through the late morning to a plateau
 * around lunch and the shops, eases, then rises to an evening outing peak that stays below the
 * weekday rush. Same caveat: a plausible shape, not a measurement.
 */
const WEEKEND_KNOTS: Knots = [
  [0, 0.45],
  [7, 0.45],
  [10, 0.9],
  [11.5, 1.25],
  [14, 1.25],
  [16.5, 1.05],
  [18, 1.55],
  [20.5, 1.55],
  [22, 0.8],
  [23.5, 0.45],
  [24, 0.45],
];

/** Chennai wall-clock hour (0 to 24) and whether the day there is a Saturday or Sunday. */
export function istClock(now: Date) {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const day = ist.getUTCDay();
  return {
    hour: ist.getUTCHours() + ist.getUTCMinutes() / 60,
    weekend: day === 0 || day === 6,
  };
}

function interpolate(knots: Knots, hour: number) {
  for (let i = 1; i < knots.length; i += 1) {
    const [h1, f1] = knots[i] as readonly [number, number];
    if (hour <= h1) {
      const [h0, f0] = knots[i - 1] as readonly [number, number];
      return h1 === h0 ? f1 : f0 + ((f1 - f0) * (hour - h0)) / (h1 - h0);
    }
  }
  return 0.45;
}

export function timeOfDayFactor(now: Date) {
  const { hour, weekend } = istClock(now);
  return interpolate(weekend ? WEEKEND_KNOTS : WEEKDAY_KNOTS, hour);
}

/**
 * Average of the demand curve over a whole week: what a fixed timer is set up for. A real timer
 * runs one plan all week, so it is tuned to the mean of five working days and two weekend days.
 */
export const MEAN_DAY_FACTOR = (() => {
  const monday = Date.UTC(2026, 0, 5, 0, 0) - 5.5 * 3600 * 1000;
  let sum = 0;
  const steps = 7 * 96;
  for (let i = 0; i < steps; i += 1) sum += timeOfDayFactor(new Date(monday + i * 15 * 60 * 1000));
  return sum / steps;
})();

/**
 * Scales synthetic demand against one approach's share of junction capacity.
 * It is a calibration choice, not a measurement: at 1.0 every approach was
 * oversaturated at rush hour, which leaves no signal plan able to help, so it
 * was lowered until the busiest approaches pass capacity at the peaks and most
 * of the network is serviceable off-peak.
 */
export const DEMAND_SCALE = 0.55;

/** Vehicles per hour that want to enter one approach. */
export function approachDemandVph(args: {
  roadId: number;
  maxCapacity: number;
  /** Demand multiplier, see timeOfDayFactor. */
  factor: number;
  demandBoost?: number;
}) {
  const approachCapacity = saturationFlow(args.maxCapacity) / APPROACHES_PER_JUNCTION;
  return (
    approachCapacity *
    DEMAND_SCALE *
    loadFor(args.roadId) *
    (args.factor / 1.15) *
    (args.demandBoost ?? 1)
  );
}

/**
 * Share of normal saturation flow left on wet roads. Drivers leave bigger gaps and slow down in
 * heavy rain; the HCM puts the loss at roughly 10 to 20 percent, so the top of that range is used.
 */
export const RAIN_CAPACITY_FACTOR = 0.8;

/** Share of normal capacity left on the approach where a lane is blocked. */
export const INCIDENT_CAPACITY_FACTOR = 0.3;

/** A blocked lane hits the busiest arm of the junction. Road ids go `junctionIndex*4 + approach + 1`. */
export function incidentRoadId(junctionIndex: number) {
  let best = junctionIndex * APPROACHES_PER_JUNCTION + 1;
  for (let a = 1; a < APPROACHES_PER_JUNCTION; a += 1) {
    const id = junctionIndex * APPROACHES_PER_JUNCTION + a + 1;
    if (loadFor(id) > loadFor(best)) best = id;
  }
  return best;
}

export type QueueStepInput = {
  roadId: number;
  maxCapacity: number;
  /** Demand multiplier, see timeOfDayFactor. */
  factor: number;
  /** Seconds since the previous step. */
  elapsedSec: number;
  /** Queue carried over from the previous step. */
  priorExact: number;
  /** Seconds of green this approach actually held inside the window. */
  greenSeconds: number;
  /** Optional per-road demand multiplier. */
  demandBoost?: number;
  /** Share of normal capacity available, e.g. while a lane is blocked. */
  capacityFactor?: number;
  rand?: () => number;
};

export type QueueStep = {
  arrivals: number;
  exact: number;
  queue: number;
  /**
   * Detector count for the window, with a little measurement noise. It is kept
   * fractional: rounding a 12 s count to whole vehicles loses most of a quiet
   * road's traffic and biases the arrival-rate estimate low.
   */
  measuredArrivals: number;
};

/**
 * Advance one approach: arrivals (demand-driven) minus discharge achieved by the
 * green time that was really running, so the queue responds to the last decision.
 */
export function stepQueue(input: QueueStepInput): QueueStep {
  const rand = input.rand ?? Math.random;
  const demandVph = approachDemandVph({
    roadId: input.roadId,
    maxCapacity: input.maxCapacity,
    factor: input.factor,
    ...(input.demandBoost === undefined ? {} : { demandBoost: input.demandBoost }),
  });
  const arrivals = ((demandVph * (0.85 + rand() * 0.3)) / 3600) * input.elapsedSec;
  const served = Math.min(
    input.priorExact + arrivals,
    (saturationFlow(input.maxCapacity, input.capacityFactor) / 3600) * input.greenSeconds,
  );
  const exact = clamp(input.priorExact + arrivals - served, 0, 150);
  return {
    arrivals,
    exact,
    queue: Math.round(exact),
    measuredArrivals: Math.max(0, arrivals * (0.9 + rand() * 0.2)),
  };
}

/**
 * Seconds of useful green inside the window [fromMs, toMs] for a phase that
 * turned green at `greenStartMs`: the first LOST_TIME_PER_PHASE seconds of a
 * phase (start-up lag and the clearance of the previous one) discharge nothing.
 */
export function effectiveGreenSeconds(greenStartMs: number, fromMs: number, toMs: number) {
  const usefulFrom = Math.max(fromMs, greenStartMs + LOST_TIME_PER_PHASE * 1000);
  return Math.max(0, (toMs - usefulFrom) / 1000);
}

// ---------------------------------------------------------------------------
// Real-time phase controller
// ---------------------------------------------------------------------------

/** Minimum seconds a phase must stay green before it can be pre-empted. */
export const MIN_PHASE_SEC = 8;
/** Never hold a phase longer than this, even under heavy demand. */
export const MAX_PHASE_SEC = 90;
/**
 * Extra pressure another approach needs before it pre-empts a running green
 * that has already served its minimum. Prevents phase flapping.
 */
export const PREEMPT_MARGIN = 0.8;
/**
 * A running green cannot be pre-empted by pressure until it has held this share of the green it
 * was allocated (at least MIN_PHASE_SEC, at most MAX_HOLD_SEC). Every phase change costs lost time
 * in which nothing discharges, so changing sooner than that gives away capacity.
 */
export const HOLD_FRACTION = 0.6;
export const MAX_HOLD_SEC = 30;
/** No approach waits on red longer than this once the running phase has served its minimum. */
export const MAX_RED_SEC = 120;
/**
 * An overdue approach takes over once the running phase has held green this long
 * (or its whole allocation, if shorter), so a chain of overdue arms each still get
 * a usable green instead of cutting one another off after the bare minimum.
 */
export const FORCED_HANDOVER_SEC = 20;
/** Each AGING_SEC spent on red adds one unit of pressure, so waiting never goes unnoticed. */
export const AGING_SEC = 180;
/** A queue of this many vehicles adds one unit of pressure. */
export const QUEUE_PRESSURE_VEH = 50;

/** Pressure = how far past capacity an approach is running right now, plus its backlog. */
export function approachPressure(model: { degreeSaturation: number; queueNow: number } | null) {
  if (!model) return 0;
  return model.degreeSaturation + model.queueNow / QUEUE_PRESSURE_VEH;
}

export type PhaseApproach = {
  roadId: number;
  isGreen: boolean;
  /** When the current phase state (green or red) began, ms since epoch. */
  startedAtMs: number;
  /** Green the model currently allocates this approach, seconds. */
  allocatedGreen: number;
  pressure: number;
};

export type PhaseDecision = {
  /** Approach that loses the green, if any. */
  endRoadId: number | null;
  startRoadId: number;
  startGreen: number;
};

/**
 * Decide, for one junction, whether the running phase ends and who gets the
 * green next. Returns null when the current phase should keep running.
 *
 * The next green goes to the approach with the highest pressure plus ageing
 * (time spent on red), and any approach that has been red for MAX_RED_SEC jumps
 * the queue, so no arm can be starved however the pressures compare.
 */
export function decidePhase(approaches: PhaseApproach[], nowMs: number): PhaseDecision | null {
  const sorted = [...approaches].sort((a, b) => a.roadId - b.roadId);
  const current = sorted.find((row) => row.isGreen);
  // A clock that stepped backwards counts as the phase having served its time.
  const elapsed =
    current && nowMs >= current.startedAtMs ? (nowMs - current.startedAtMs) / 1000 : Infinity;
  const allocated = current ? clamp(current.allocatedGreen, MIN_PHASE_SEC, MAX_PHASE_SEC) : 0;

  let challenger: PhaseApproach | null = null;
  let challengerScore = -Infinity;
  let challengerRed = -1;
  let overdue: PhaseApproach | null = null;
  let overdueRed = -1;

  for (const row of sorted) {
    if (current && row.roadId === current.roadId) continue;
    const redSec = Math.max(0, (nowMs - row.startedAtMs) / 1000);
    const score = row.pressure + redSec / AGING_SEC;
    // Ties go to whoever has waited longest, not to the lowest road id.
    if (score > challengerScore || (score === challengerScore && redSec > challengerRed)) {
      challengerScore = score;
      challengerRed = redSec;
      challenger = row;
    }
    if (redSec >= MAX_RED_SEC && redSec > overdueRed) {
      overdueRed = redSec;
      overdue = row;
    }
  }

  const next = overdue ?? challenger;
  if (!next) return null;

  const servedGreen = elapsed >= allocated;
  const forcedAfter = Math.max(MIN_PHASE_SEC, Math.min(allocated, FORCED_HANDOVER_SEC));
  const holdFor = Math.min(MAX_HOLD_SEC, Math.max(MIN_PHASE_SEC, allocated * HOLD_FRACTION));
  const preempted =
    !!current &&
    ((overdue !== null && elapsed >= forcedAfter) ||
      (elapsed >= holdFor && challengerScore > current.pressure + PREEMPT_MARGIN));

  if (current && !servedGreen && !preempted) return null;

  return {
    endRoadId: current ? current.roadId : null,
    startRoadId: next.roadId,
    startGreen: Math.round(clamp(next.allocatedGreen, MIN_PHASE_SEC, MAX_PHASE_SEC)),
  };
}
