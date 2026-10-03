/**
 * Pure simulation rules shared by the live backend (traffic.functions.ts) and
 * the in-browser demo engine, so both behave identically. No I/O in here.
 */
import { FIXED_GREEN, clamp, saturationFlow } from "@/lib/traffic-model";

/**
 * Deterministic per-road "personality": how heavily loaded this approach runs
 * relative to its own capacity (0.45 = under half, ~1.4 = well over).
 */
export function loadFor(roadId: number) {
  const seed = Math.sin(roadId * 12.9898) * 43758.5453;
  const frac = seed - Math.floor(seed);
  return 0.45 + frac * 0.95;
}

/** Chennai (UTC+5:30) rush hour shaping of demand. */
export function timeOfDayFactor(now: Date) {
  const istHour = (now.getUTCHours() + 5.5 + now.getUTCMinutes() / 60) % 24;
  if (istHour >= 8 && istHour < 10) return 1.75;
  if (istHour >= 17 && istHour < 20) return 1.9;
  if (istHour >= 10 && istHour < 17) return 1.15;
  if (istHour >= 20 && istHour < 23) return 0.9;
  return 0.45;
}

/**
 * Scales synthetic demand against one approach's share of junction capacity.
 * At 1.0 every approach was oversaturated at rush hour, which leaves no signal
 * plan able to help; 0.55 gives a realistic mix, with the busiest approaches
 * past capacity at peak and most of the network serviceable off-peak.
 */
export const DEMAND_SCALE = 0.55;

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
  /** Optional per-road demand multiplier, e.g. a simulated incident. */
  demandBoost?: number;
  rand?: () => number;
};

export type QueueStep = {
  arrivals: number;
  exact: number;
  queue: number;
  /** Detector count for the window, with a little measurement noise. */
  measuredArrivals: number;
};

/**
 * Advance one approach: arrivals (demand-driven) minus discharge achieved by the
 * green time that was really running, so the queue responds to the last decision.
 */
export function stepQueue(input: QueueStepInput): QueueStep {
  const rand = input.rand ?? Math.random;
  const approachCapacity = saturationFlow(input.maxCapacity) / 4;
  const demandVph =
    approachCapacity *
    DEMAND_SCALE *
    loadFor(input.roadId) *
    (input.factor / 1.15) *
    (input.demandBoost ?? 1);
  const arrivals = ((demandVph * (0.85 + rand() * 0.3)) / 3600) * input.elapsedSec;
  const served = Math.min(
    input.priorExact + arrivals,
    (saturationFlow(input.maxCapacity) / 3600) * input.greenSeconds,
  );
  const exact = clamp(input.priorExact + arrivals - served, 0, 150);
  return {
    arrivals,
    exact,
    queue: Math.round(exact),
    measuredArrivals: Math.max(0, Math.round(arrivals * (0.9 + rand() * 0.2))),
  };
}

/** Seconds of green an approach really held in the window that just finished. */
export function greenSecondsHeld(wasGreen: boolean, elapsedSec: number, allocatedGreen?: number) {
  return wasGreen ? Math.min(elapsedSec, allocatedGreen ?? FIXED_GREEN) : 0;
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
export const PREEMPT_MARGIN = 0.25;

/** Pressure = how far past capacity an approach is running right now. */
export function approachPressure(model: { degreeSaturation: number; queueNow: number } | null) {
  if (!model) return 0;
  return model.degreeSaturation + model.queueNow / 200;
}

export type PhaseApproach = {
  roadId: number;
  isGreen: boolean;
  /** When the current phase state began (ms since epoch). */
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
 */
export function decidePhase(approaches: PhaseApproach[], nowMs: number): PhaseDecision | null {
  const sorted = [...approaches].sort((a, b) => a.roadId - b.roadId);
  const current = sorted.find((row) => row.isGreen);
  const elapsed = current ? (nowMs - current.startedAtMs) / 1000 : Infinity;
  const allocated = current ? clamp(current.allocatedGreen, MIN_PHASE_SEC, MAX_PHASE_SEC) : 0;

  // Best challenger: worst pressure among the approaches waiting on red.
  let challenger: PhaseApproach | null = null;
  let challengerPressure = -1;
  for (const row of sorted) {
    if (current && row.roadId === current.roadId) continue;
    if (row.pressure > challengerPressure) {
      challengerPressure = row.pressure;
      challenger = row;
    }
  }

  const servedGreen = elapsed >= allocated;
  const preempted =
    !!current && elapsed >= MIN_PHASE_SEC && challengerPressure > current.pressure + PREEMPT_MARGIN;

  if (current && !servedGreen && !preempted) return null;
  if (!challenger) return null;

  return {
    endRoadId: current ? current.roadId : null,
    startRoadId: challenger.roadId,
    startGreen: Math.round(clamp(challenger.allocatedGreen, MIN_PHASE_SEC, MAX_PHASE_SEC)),
  };
}
