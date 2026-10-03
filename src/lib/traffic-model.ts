/**
 * Traffic flow model.
 *
 * Instead of comparing an arbitrary green time against a fixed 30s timer, this
 * models each approach as a queue with an arrival rate and a discharge
 * (saturation flow) rate, then:
 *
 *  1. estimates the arrival rate from detector counts (or, failing that, from
 *     vehicle conservation between two queue readings);
 *  2. picks a cycle length with Webster's optimal-cycle formula;
 *  3. splits effective green in proportion to flow ratios y = q / s, and makes
 *     the cycle equal the sum of the greens plus the lost time, so delays and
 *     degrees of saturation are computed for the plan that is really run;
 *  4. predicts average delay per vehicle with the HCM signalised-delay
 *     equation (uniform + incremental delay), for the adaptive plan and for a
 *     fixed-time reference plan. Both numbers are model predictions from the
 *     same formula; nothing is measured under the fixed plan;
 *  5. predicts next-cycle queue length, which is checked against the next
 *     observed reading to score the model.
 */

export const MIN_GREEN = 12;
export const MAX_GREEN = 90;
export const MIN_CYCLE = 60;
export const MAX_CYCLE = 150;
/** Lost time per phase (startup lag + intergreen clearance), seconds. */
export const LOST_TIME_PER_PHASE = 4;
/** Naive reference plan: an equal split of a 120 s cycle. */
export const FIXED_CYCLE = 120;
/**
 * A real fixed-time plan must also pay the inter-green lost time, so an equal
 * four-phase split of a 120 s cycle gives each approach (120 - 4x4)/4 = 26 s.
 */
export const FIXED_GREEN = (FIXED_CYCLE - 4 * LOST_TIME_PER_PHASE) / 4;
/** Floor for any estimated arrival rate, veh/h. Low enough not to bias quiet roads. */
export const MIN_ARRIVAL_VPH = 5;
const MAX_ARRIVAL_VPH = 2600;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Saturation flow (veh/h of green) scaled by the approach's lane capacity. */
export function saturationFlow(maxCapacity: number, capacityFactor = 1) {
  return clamp(1800 * (maxCapacity / 100), 900, 2400) * capacityFactor;
}

/** A signal plan: one green per approach, and the cycle they add up to. */
export type SignalPlan = { cycle: number; greens: number[] };

/**
 * Webster cycle and green split for the given flow ratios (one per phase).
 * The cycle is always the sum of the greens plus the lost time, so what the
 * delay formulas see is the plan that would actually run.
 */
export function planSignals(flowRatios: number[]): SignalPlan {
  const phases = Math.max(flowRatios.length, 1);
  const lostTime = phases * LOST_TIME_PER_PHASE;
  const total = flowRatios.reduce((sum, r) => sum + r, 0);

  // Webster optimal cycle: C0 = (1.5L + 5) / (1 - Y)
  const y = Math.min(total, 0.92);
  const optimal = clamp((1.5 * lostTime + 5) / (1 - y), MIN_CYCLE, MAX_CYCLE);
  const effectiveGreenTotal = Math.max(Math.round(optimal) - lostTime, phases * MIN_GREEN);

  // Split in proportion to flow, each green held inside [MIN_GREEN, MAX_GREEN]. Phases
  // lifted to the minimum make the cycle longer than the optimum, which is right: the
  // busy phase keeps the share it needs. Only if that pushes past MAX_CYCLE are the
  // phases above their minimum trimmed back, in proportion to what they have above it.
  const greens = flowRatios.map((ratio) => {
    const share = total > 0 ? ratio / total : 1 / phases;
    return clamp(effectiveGreenTotal * share, MIN_GREEN, MAX_GREEN);
  });
  const budget = MAX_CYCLE - lostTime;
  const used = greens.reduce((sum, g) => sum + g, 0);
  if (used > budget) {
    const spare = greens.reduce((sum, g) => sum + (g - MIN_GREEN), 0);
    const keep = Math.max(0, budget - phases * MIN_GREEN) / (spare || 1);
    greens.forEach((g, i) => {
      greens[i] = MIN_GREEN + (g - MIN_GREEN) * keep;
    });
  }

  const rounded = greens.map((g) => Math.round(clamp(g, MIN_GREEN, MAX_GREEN)));
  // Rounding can overshoot the budget by a second or two: take it back from the longest green.
  while (rounded.reduce((sum, g) => sum + g, 0) > Math.max(budget, phases * MIN_GREEN)) {
    const longest = rounded.indexOf(Math.max(...rounded));
    if ((rounded[longest] ?? 0) <= MIN_GREEN) break;
    rounded[longest] = (rounded[longest] ?? 0) - 1;
  }
  const cycle = rounded.reduce((sum, g) => sum + g, 0) + lostTime;
  return { cycle, greens: rounded };
}

/**
 * A fixed-time plan set up for the long-run demand of a junction, the way a
 * real timer is programmed from historical counts. It never reacts to the
 * hour, which is exactly why the adaptive plan can beat it.
 */
export function fixedPlanFromDemand(arrivalVph: number[], saturationFlowVph: number[]): SignalPlan {
  return planSignals(
    arrivalVph.map((q, i) => clamp(q / (saturationFlowVph[i] ?? 1800), 0.01, 0.95)),
  );
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
  /** Share of normal capacity left, e.g. 0.4 while a lane is blocked. */
  capacityFactor?: number;
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
  /**
   * Modelled vehicle-seconds of waiting removed during the window just
   * analysed: (fixed delay - adaptive delay) x vehicles that arrived in it.
   * Signed: it is negative where the adaptive plan is predicted to be worse.
   */
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
 * Arrival rate from detector counts, falling back to vehicle conservation:
 * arrivals = (queue_now - queue_before) + vehicles discharged during green.
 */
function estimateArrivalRate(input: ApproachInput, elapsedSec: number) {
  const s = saturationFlow(input.maxCapacity, input.capacityFactor);
  const prior0 = input.previousArrivalRate;

  // Detector counts are the direct measurement: vehicles crossing the stop
  // line approach during the window. Queue conservation is the fallback.
  if (input.measuredArrivals !== null && input.measuredArrivals !== undefined && elapsedSec > 0) {
    const instant = (input.measuredArrivals * 3600) / elapsedSec;
    return clamp((prior0 ?? instant) * 0.7 + instant * 0.3, MIN_ARRIVAL_VPH, MAX_ARRIVAL_VPH);
  }

  if (input.previousQueue === null || elapsedSec <= 0) {
    // Cold start: assume the observed queue arrived over one nominal cycle.
    return clamp((input.queue * 3600) / FIXED_CYCLE, MIN_ARRIVAL_VPH, MAX_ARRIVAL_VPH);
  }
  const discharged = Math.min(input.previousQueue, (s / 3600) * input.previousGreen);
  const arrivals = Math.max(0, input.queue - input.previousQueue + discharged);
  const instant = (arrivals * 3600) / elapsedSec;
  const prior = input.previousArrivalRate ?? instant;
  // Exponentially weighted smoothing keeps the estimate stable under sensor noise.
  return clamp(prior * 0.55 + instant * 0.45, MIN_ARRIVAL_VPH, MAX_ARRIVAL_VPH);
}

/** Length of the analysis period for the incremental delay term, hours. */
const ANALYSIS_HOURS = 0.25;
const MAX_DELAY_SEC = 600;

/**
 * Average control delay per vehicle (s): HCM uniform delay d1 plus incremental
 * delay d2 (random arrivals and oversaturation over a 15 minute period).
 * Continuous at x = 1 and non-decreasing in demand, non-increasing in green.
 */
export function websterDelay(args: {
  cycle: number;
  green: number;
  arrivalRateVph: number;
  saturationFlowVph: number;
}) {
  const { cycle, green } = args;
  const lambda = clamp(green / cycle, 0, 0.99);
  const capacityVph = args.saturationFlowVph * lambda;
  if (capacityVph <= 0) return MAX_DELAY_SEC;

  const x = args.arrivalRateVph / capacityVph;
  const uniform = (0.5 * cycle * (1 - lambda) ** 2) / Math.max(0.05, 1 - Math.min(1, x) * lambda);

  // k = 0.5 for pre-timed signals, I = 1 for an isolated junction.
  const k = 0.5;
  const incremental =
    900 *
    ANALYSIS_HOURS *
    (x - 1 + Math.sqrt((x - 1) ** 2 + (8 * k * x) / (capacityVph * ANALYSIS_HOURS)));

  return clamp(uniform + incremental, 0, MAX_DELAY_SEC);
}

/**
 * Solve one junction: cycle length, green split, predicted delay and queues.
 * `fixedPlan` is the reference timer the adaptive plan is compared with; when
 * omitted an equal split of a 120 s cycle is used.
 */
export function solveJunction(
  inputs: ApproachInput[],
  elapsedSec: number,
  fixedPlan?: SignalPlan,
): JunctionModel {
  const base = inputs.map((input) => {
    const arrivalRateVph = estimateArrivalRate(input, elapsedSec);
    const saturationFlowVph = saturationFlow(input.maxCapacity, input.capacityFactor);
    return {
      input,
      arrivalRateVph,
      saturationFlowVph,
      flowRatio: clamp(arrivalRateVph / saturationFlowVph, 0.01, 0.95),
    };
  });

  const totalFlowRatio = base.reduce((sum, b) => sum + b.flowRatio, 0);
  const plan = planSignals(base.map((b) => b.flowRatio));
  const cycleLength = plan.cycle;

  const approaches: ApproachModel[] = base.map((b, index) => {
    const green = plan.greens[index] ?? MIN_GREEN;
    const fixedCycle = fixedPlan?.cycle ?? FIXED_CYCLE;
    const fixedGreen = fixedPlan?.greens[index] ?? FIXED_GREEN;

    const delayAdaptive = websterDelay({
      cycle: cycleLength,
      green,
      arrivalRateVph: b.arrivalRateVph,
      saturationFlowVph: b.saturationFlowVph,
    });
    const delayFixed = websterDelay({
      cycle: fixedCycle,
      green: fixedGreen,
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
    const degreeSaturation = capacity > 0 ? b.arrivalRateVph / 3600 / capacity : 2;
    const arrivedInWindow = (b.arrivalRateVph / 3600) * Math.max(elapsedSec, 0);

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
      savedVehicleSeconds: Number(((delayFixed - delayAdaptive) * arrivedInWindow).toFixed(2)),
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
