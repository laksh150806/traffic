/**
 * Traffic flow model.
 *
 * Instead of comparing an arbitrary green time against a fixed 30s timer, this
 * models each approach as a queue with an arrival rate and a discharge
 * (saturation flow) rate, then:
 *
 *  1. estimates the arrival rate from consecutive live readings and how much
 *     traffic the previous green could actually discharge (conservation of
 *     vehicles);
 *  2. picks a cycle length with Webster's optimal-cycle formula;
 *  3. splits effective green in proportion to flow ratios y = q / s;
 *  4. predicts average delay per vehicle with Webster's delay equation, both
 *     for the adaptive plan and for the fixed-time plan, so the "saving" is a
 *     modelled prediction rather than a timer difference;
 *  5. predicts next-cycle queue length, which is checked against the next
 *     observed reading to score the model.
 */

export const MIN_GREEN = 12;
export const MAX_GREEN = 90;
export const MIN_CYCLE = 60;
export const MAX_CYCLE = 150;
/** Lost time per phase (startup lag + intergreen clearance), seconds. */
export const LOST_TIME_PER_PHASE = 4;
/** Fixed-time reference plan: 30s green inside a 120s cycle. */
export const FIXED_CYCLE = 120;
/**
 * A real fixed-time plan must also pay the inter-green lost time, so an equal
 * four-phase split of a 120 s cycle gives each approach (120 - 4x4)/4 = 26 s.
 */
export const FIXED_GREEN = (FIXED_CYCLE - 4 * LOST_TIME_PER_PHASE) / 4;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Saturation flow (veh/h of green) scaled by the approach's lane capacity. */
export function saturationFlow(maxCapacity: number) {
  return clamp(1800 * (maxCapacity / 100), 900, 2400);
}

export type ApproachInput = {
  roadId: number;
  /** Latest observed queue / vehicles present on the approach. */
  queue: number;
  /** Previous observed queue, if we have one. */
  previousQueue: number | null;
  /** Green seconds served during the previous cycle. */
  previousGreen: number;
  /** Previously estimated arrival rate, veh/h. */
  previousArrivalRate: number | null;
  /** Vehicles counted crossing the detector during the window, if available. */
  measuredArrivals?: number | null;
  maxCapacity: number;
};

export type ApproachModel = {
  roadId: number;
  queue: number;
  arrivalRateVph: number;
  saturationFlowVph: number;
  flowRatio: number;
  green: number;
  degreeSaturation: number;
  delayAdaptive: number;
  delayFixed: number;
  predictedQueueNext: number;
  queueClears: boolean;
  /** Modelled vehicle-seconds of waiting removed this cycle. */
  savedVehicleSeconds: number;
};

export type JunctionModel = {
  cycleLength: number;
  /** Sum of flow ratios: >0.9 means the junction is at capacity. */
  totalFlowRatio: number;
  approaches: ApproachModel[];
  delayAdaptive: number;
  delayFixed: number;
};

/**
 * Arrival rate from vehicle conservation:
 * arrivals = (queue_now - queue_before) + vehicles discharged during green.
 */
function estimateArrivalRate(input: ApproachInput, elapsedSec: number) {
  const s = saturationFlow(input.maxCapacity);
  const prior0 = input.previousArrivalRate;

  // Detector counts are the direct measurement: vehicles crossing the stop
  // line approach during the window. Queue conservation is the fallback.
  if (input.measuredArrivals !== null && input.measuredArrivals !== undefined && elapsedSec > 0) {
    const instant = (input.measuredArrivals * 3600) / elapsedSec;
    return clamp((prior0 ?? instant) * 0.6 + instant * 0.4, 60, 2600);
  }

  if (input.previousQueue === null || elapsedSec <= 0) {
    // Cold start: assume the observed queue arrived over one nominal cycle.
    return clamp((input.queue * 3600) / FIXED_CYCLE, 60, 2600);
  }
  const discharged = Math.min(input.previousQueue, (s / 3600) * input.previousGreen);
  const arrivals = Math.max(0, input.queue - input.previousQueue + discharged);
  const instant = (arrivals * 3600) / elapsedSec;
  const prior = input.previousArrivalRate ?? instant;
  // Exponentially weighted smoothing keeps the estimate stable under sensor noise.
  return clamp(prior * 0.55 + instant * 0.45, 60, 2600);
}

/** Webster's average delay per vehicle (s), with an oversaturation term. */
export function websterDelay(args: {
  cycle: number;
  green: number;
  arrivalRateVph: number;
  saturationFlowVph: number;
}) {
  const { cycle, green } = args;
  const q = args.arrivalRateVph / 3600; // veh/s
  const s = args.saturationFlowVph / 3600;
  const lambda = green / cycle;
  const capacity = s * lambda; // veh/s the approach can serve
  const x = capacity > 0 ? q / capacity : 2;
  const y = clamp(q / s, 0, 0.98);

  // Uniform delay: waiting caused purely by the red interval.
  const uniform = (cycle * Math.pow(1 - lambda, 2)) / (2 * (1 - Math.min(y, 0.97)));

  // Random / overflow delay, bounded so saturated approaches stay finite.
  const xc = Math.min(x, 0.98);
  const random = q > 0 ? Math.pow(xc, 2) / (2 * q * (1 - xc)) : 0;

  // Beyond capacity, residual queue grows every cycle: add deterministic
  // oversaturation delay for the vehicles that cannot be served.
  const oversaturation = x > 1 ? ((x - 1) * cycle) / 2 : 0;

  return clamp(uniform + Math.min(random, 240) + oversaturation, 0, 600);
}

/**
 * Solve one junction: cycle length, green split, predicted delay and queues.
 */
export function solveJunction(inputs: ApproachInput[], elapsedSec: number): JunctionModel {
  const phases = Math.max(inputs.length, 1);
  const lostTime = phases * LOST_TIME_PER_PHASE;

  const base = inputs.map((input) => {
    const arrivalRateVph = estimateArrivalRate(input, elapsedSec);
    const saturationFlowVph = saturationFlow(input.maxCapacity);
    return {
      input,
      arrivalRateVph,
      saturationFlowVph,
      flowRatio: clamp(arrivalRateVph / saturationFlowVph, 0.01, 0.95),
    };
  });

  const totalFlowRatio = base.reduce((sum, b) => sum + b.flowRatio, 0);
  // Webster optimal cycle: C0 = (1.5L + 5) / (1 - Y)
  const y = Math.min(totalFlowRatio, 0.92);
  const optimal = (1.5 * lostTime + 5) / (1 - y);
  const cycleLength = Math.round(clamp(optimal, MIN_CYCLE, MAX_CYCLE));
  const effectiveGreenTotal = Math.max(cycleLength - lostTime, phases * MIN_GREEN);

  const approaches: ApproachModel[] = base.map((b) => {
    const share = totalFlowRatio > 0 ? b.flowRatio / totalFlowRatio : 1 / phases;
    const green = Math.round(clamp(effectiveGreenTotal * share, MIN_GREEN, MAX_GREEN));

    const delayAdaptive = websterDelay({
      cycle: cycleLength,
      green,
      arrivalRateVph: b.arrivalRateVph,
      saturationFlowVph: b.saturationFlowVph,
    });
    const delayFixed = websterDelay({
      cycle: FIXED_CYCLE,
      green: FIXED_GREEN,
      arrivalRateVph: b.arrivalRateVph,
      saturationFlowVph: b.saturationFlowVph,
    });

    const arrivalsPerCycle = (b.arrivalRateVph / 3600) * cycleLength;
    const dischargeCapacity = (b.saturationFlowVph / 3600) * green;
    const predictedQueueNext = Math.max(
      0,
      Math.round(b.input.queue + arrivalsPerCycle - dischargeCapacity),
    );
    const capacity = (b.saturationFlowVph / 3600) * (green / cycleLength);
    const degreeSaturation = capacity > 0 ? (b.arrivalRateVph / 3600) / capacity : 2;

    return {
      roadId: b.input.roadId,
      queue: b.input.queue,
      arrivalRateVph: Math.round(b.arrivalRateVph),
      saturationFlowVph: Math.round(b.saturationFlowVph),
      flowRatio: Number(b.flowRatio.toFixed(3)),
      green,
      degreeSaturation: Number(degreeSaturation.toFixed(3)),
      delayAdaptive: Number(delayAdaptive.toFixed(1)),
      delayFixed: Number(delayFixed.toFixed(1)),
      predictedQueueNext,
      queueClears: predictedQueueNext <= Math.max(2, b.input.queue * 0.15),
      savedVehicleSeconds: Math.round((delayFixed - delayAdaptive) * arrivalsPerCycle),
    };
  });

  const flowTotal = approaches.reduce((sum, a) => sum + a.arrivalRateVph, 0) || 1;
  const weighted = (pick: (a: ApproachModel) => number) =>
    Number(
      (approaches.reduce((sum, a) => sum + pick(a) * a.arrivalRateVph, 0) / flowTotal).toFixed(1),
    );

  return {
    cycleLength,
    totalFlowRatio: Number(totalFlowRatio.toFixed(3)),
    approaches,
    delayAdaptive: weighted((a) => a.delayAdaptive),
    delayFixed: weighted((a) => a.delayFixed),
  };
}
