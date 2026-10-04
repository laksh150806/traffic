/**
 * Replays half an hour at one junction twice, with identical traffic: once under the junction's
 * fixed timer and once under the adaptive controller, so the difference can be seen as a queue
 * over time instead of read as a percentage.
 *
 * The adaptive run is the same loop the live engine runs (a model tick every 12 s that re-solves
 * the plan, a phase decision every 2 s from `decidePhase`). The fixed run steps through the
 * junction's fixed plan. Both share the arrival noise, the start-up lost time per phase and the
 * starting queues, which are what the junction settles at for that hour. The traffic itself is the
 * simulator's demand curve, so this shows how the two controllers compare on simulated demand,
 * not on a measured road.
 */
import { fixedPlanForJunction } from "@/lib/fixed-plan";
import { forecastJunction } from "@/lib/forecast";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import {
  APPROACHES_PER_JUNCTION,
  INCIDENT_CAPACITY_FACTOR,
  approachPressure,
  decidePhase,
  effectiveGreenSeconds,
  incidentRoadId,
  stepQueue,
  timeOfDayFactor,
  type PhaseApproach,
} from "@/lib/sim-core";
import {
  FIXED_GREEN,
  LOST_TIME_PER_PHASE,
  solveJunction,
  type ApproachInput,
} from "@/lib/traffic-model";

const STEP_SEC = 2;
const TICK_SEC = 12;

export type ReplayOptions = {
  /** Length of the replay, minutes. Default 30. */
  minutes?: number;
  /** Demand multiplier to use instead of the clock's (a forced scenario). */
  factor?: number;
  /** Replay with the busiest arm's lane blocked. */
  blocked?: boolean;
  /** Share of normal capacity every approach has (wet roads). */
  capacityScale?: number;
  seed?: number;
};

export type ReplayResult = {
  /** Seconds from the start of each sample. */
  seconds: number[];
  /** Vehicles queued across the four approaches at each sample. */
  fixed: number[];
  adaptive: number[];
  summary: {
    avgQueueFixed: number;
    avgQueueAdaptive: number;
    maxQueueFixed: number;
    maxQueueAdaptive: number;
    /** Mean wait per vehicle, seconds, from Little's law (average queue over arrival rate). */
    waitFixed: number;
    waitAdaptive: number;
    /** Percent shorter the adaptive wait is than the fixed one; negative when it is longer. */
    waitChangePercent: number;
    /** Longest any approach stayed red, seconds. */
    longestRedFixed: number;
    longestRedAdaptive: number;
    arrivalsPerHour: number;
    /** Vehicles that got through the junction in the replay. */
    servedFixed: number;
    servedAdaptive: number;
    /** Times the green changed hands. */
    switchesFixed: number;
    switchesAdaptive: number;
  };
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Approach = {
  roadId: number;
  queueExact: number;
  greenAccumSec: number;
  accruedAtMs: number;
  isGreen: boolean;
  phaseStartMs: number;
  /** Green the plan currently gives this approach. */
  greenSec: number;
  model: {
    arrivalRate: number;
    degreeSaturation: number;
    queueNow: number;
    green: number;
  } | null;
  redSince: number;
  longestRedSec: number;
};

const sumQueue = (rows: Approach[]) => rows.reduce((sum, r) => sum + r.queueExact, 0);

export function replayJunction(
  junctionIndex: number,
  startMs: number,
  options: ReplayOptions = {},
): ReplayResult {
  const seed = SEED_JUNCTIONS[junctionIndex];
  if (!seed) throw new RangeError(`No junction at index ${junctionIndex}`);
  const minutes = options.minutes ?? 30;
  const totalSec = minutes * 60;
  const plan = fixedPlanForJunction(seed.id);
  const fixedGreens = plan?.greens ?? Array.from({ length: 4 }, () => FIXED_GREEN);
  const blockedRoad = options.blocked ? incidentRoadId(junctionIndex) : null;

  // Starting queues: what this junction settles to at this hour, the same start the simulation uses.
  const start = forecastJunction(junctionIndex, new Date(startMs), {
    ...(options.factor === undefined ? {} : { factor: options.factor }),
    ...(options.blocked ? { incidents: new Set([seed.id]) } : {}),
    ...(options.capacityScale === undefined ? {} : { capacityScale: options.capacityScale }),
  });

  const roadIds = Array.from(
    { length: APPROACHES_PER_JUNCTION },
    (_, a) => junctionIndex * APPROACHES_PER_JUNCTION + a + 1,
  );
  const fresh = (): Approach[] =>
    roadIds.map((roadId, a) => ({
      roadId,
      queueExact: start.approachQueues[a] ?? 0,
      greenAccumSec: 0,
      accruedAtMs: startMs,
      isGreen: false,
      phaseStartMs: startMs,
      greenSec: fixedGreens[a] ?? FIXED_GREEN,
      model: null,
      redSince: startMs,
      longestRedSec: 0,
    }));

  const factorAt = (ms: number) => options.factor ?? timeOfDayFactor(new Date(ms));
  const capacityOf = (roadId: number) =>
    (roadId === blockedRoad ? INCIDENT_CAPACITY_FACTOR : 1) * (options.capacityScale ?? 1);

  /** Move every queue forward by one model window, given the green each approach really got. */
  const advanceQueues = (rows: Approach[], nowMs: number, rand: () => number) => {
    const measured: number[] = [];
    const queues: number[] = [];
    const exacts: number[] = [];
    let served = 0;
    rows.forEach((row) => {
      const step = stepQueue({
        roadId: row.roadId,
        maxCapacity: seed.capacity,
        factor: factorAt(nowMs),
        elapsedSec: TICK_SEC,
        priorExact: row.queueExact,
        greenSeconds: row.greenAccumSec,
        capacityFactor: capacityOf(row.roadId),
        rand,
      });
      served += row.queueExact + step.arrivals - step.exact;
      measured.push(step.measuredArrivals);
      queues.push(step.queue);
      exacts.push(step.exact);
    });
    return { measured, queues, exacts, served };
  };

  /** A red spell ends when the approach is next green; track the longest. */
  const trackRed = (row: Approach, nowMs: number) => {
    if (!row.isGreen)
      row.longestRedSec = Math.max(row.longestRedSec, (nowMs - row.redSince) / 1000);
  };

  // -------------------------------------------------------------------------- adaptive
  const runAdaptive = () => {
    const rand = mulberry32((options.seed ?? 1) * 7919 + seed.id);
    const rows = fresh();
    const samples: number[] = [];
    let served = 0;
    let switches = 0;
    // Start with the first approach green, as the live engine does.
    rows[0]!.isGreen = true;
    for (let t = STEP_SEC; t <= totalSec; t += STEP_SEC) {
      const nowMs = startMs + t * 1000;
      for (const row of rows) {
        if (row.isGreen) {
          row.greenAccumSec += effectiveGreenSeconds(row.phaseStartMs, row.accruedAtMs, nowMs);
        }
        row.accruedAtMs = nowMs;
        trackRed(row, nowMs);
      }

      if (t % TICK_SEC === 0) {
        const { measured, queues, exacts, served: got } = advanceQueues(rows, nowMs, rand);
        served += got;
        const inputs: ApproachInput[] = rows.map((row, a) => ({
          roadId: row.roadId,
          queue: queues[a] ?? 0,
          previousQueue: Math.round(row.queueExact),
          previousGreen: row.greenAccumSec,
          previousArrivalRate: row.model ? row.model.arrivalRate : null,
          measuredArrivals: measured[a] ?? null,
          maxCapacity: seed.capacity,
          capacityFactor: capacityOf(row.roadId),
        }));
        const solved = solveJunction(inputs, TICK_SEC, plan);
        rows.forEach((row, a) => {
          const model = solved.approaches[a];
          row.greenAccumSec = 0;
          row.queueExact = exacts[a] ?? 0;
          if (!model) return;
          row.greenSec = model.green;
          row.model = {
            arrivalRate: model.arrivalRateVph,
            degreeSaturation: model.degreeSaturation,
            queueNow: model.queue,
            green: model.green,
          };
        });
        samples.push(sumQueue(rows));
      }

      const phaseRows: PhaseApproach[] = rows.map((row) => ({
        roadId: row.roadId,
        isGreen: row.isGreen,
        startedAtMs: row.phaseStartMs,
        allocatedGreen: row.model?.green ?? row.greenSec,
        pressure: approachPressure(
          row.model
            ? { degreeSaturation: row.model.degreeSaturation, queueNow: row.model.queueNow }
            : null,
        ),
      }));
      const decision = decidePhase(phaseRows, nowMs);
      if (decision) {
        const ending = rows.find((r) => r.roadId === decision.endRoadId);
        if (ending) {
          switches += 1;
          ending.isGreen = false;
          ending.phaseStartMs = nowMs;
          ending.redSince = nowMs;
        }
        const starting = rows.find((r) => r.roadId === decision.startRoadId);
        if (starting) {
          starting.longestRedSec = Math.max(
            starting.longestRedSec,
            (nowMs - starting.redSince) / 1000,
          );
          starting.isGreen = true;
          starting.greenSec = decision.startGreen;
          starting.phaseStartMs = nowMs;
        }
      }
    }
    return {
      samples,
      served,
      switches,
      longestRed: Math.max(...rows.map((r) => r.longestRedSec)),
      arrivalsPerHour: rows.reduce((sum, r) => sum + (r.model?.arrivalRate ?? 0), 0),
    };
  };

  // -------------------------------------------------------------------------- fixed timer
  const runFixed = () => {
    const rand = mulberry32((options.seed ?? 1) * 7919 + seed.id);
    const rows = fresh();
    const samples: number[] = [];
    let served = 0;
    // Phase i runs for its green plus the lost time; the cycle is their sum.
    const lengths = fixedGreens.map((g) => g + LOST_TIME_PER_PHASE);
    const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
    const cycle = lengths.reduce((a, b) => a + b, 0);

    /** Seconds of useful green approach `a` gets inside [from, to) seconds. */
    const usefulGreen = (a: number, from: number, to: number) => {
      let total = 0;
      const open = offsets[a]! + LOST_TIME_PER_PHASE;
      const close = offsets[a]! + lengths[a]!;
      for (let k = Math.floor(from / cycle); k * cycle < to; k += 1) {
        const lo = Math.max(from, k * cycle + open);
        const hi = Math.min(to, k * cycle + close);
        if (hi > lo) total += hi - lo;
      }
      return total;
    };

    let lastRed = rows.map(() => 0);
    for (let t = STEP_SEC; t <= totalSec; t += STEP_SEC) {
      rows.forEach((row, a) => {
        row.greenAccumSec += usefulGreen(a, t - STEP_SEC, t);
        // Red spells: the approach is green from the start of its slot.
        const within = t % cycle;
        const green = within >= offsets[a]! && within < offsets[a]! + lengths[a]!;
        if (green) lastRed[a] = t;
        row.longestRedSec = Math.max(row.longestRedSec, t - (lastRed[a] ?? 0));
      });
      if (t % TICK_SEC === 0) {
        const nowMs = startMs + t * 1000;
        const { exacts, served: got } = advanceQueues(rows, nowMs, rand);
        served += got;
        rows.forEach((row, a) => {
          row.greenAccumSec = 0;
          row.queueExact = exacts[a] ?? 0;
        });
        samples.push(sumQueue(rows));
      }
    }
    lastRed = [];
    return {
      samples,
      served,
      switches: Math.floor(totalSec / cycle) * rows.length,
      longestRed: Math.max(...rows.map((r) => r.longestRedSec)),
    };
  };

  const adaptive = runAdaptive();
  const fixed = runFixed();

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const avgFixed = mean(fixed.samples);
  const avgAdaptive = mean(adaptive.samples);
  const flowPerSec = Math.max(adaptive.arrivalsPerHour, 1) / 3600;
  const waitFixed = avgFixed / flowPerSec;
  const waitAdaptive = avgAdaptive / flowPerSec;

  return {
    seconds: fixed.samples.map((_, i) => (i + 1) * TICK_SEC),
    fixed: fixed.samples.map((v) => Number(v.toFixed(1))),
    adaptive: adaptive.samples.map((v) => Number(v.toFixed(1))),
    summary: {
      avgQueueFixed: Number(avgFixed.toFixed(1)),
      avgQueueAdaptive: Number(avgAdaptive.toFixed(1)),
      maxQueueFixed: Number(Math.max(...fixed.samples).toFixed(1)),
      maxQueueAdaptive: Number(Math.max(...adaptive.samples).toFixed(1)),
      waitFixed: Math.round(waitFixed),
      waitAdaptive: Math.round(waitAdaptive),
      waitChangePercent:
        waitFixed > 0 ? Math.round(((waitFixed - waitAdaptive) / waitFixed) * 100) : 0,
      longestRedFixed: Math.round(fixed.longestRed),
      longestRedAdaptive: Math.round(adaptive.longestRed),
      arrivalsPerHour: Math.round(adaptive.arrivalsPerHour),
      servedFixed: Math.round(fixed.served),
      servedAdaptive: Math.round(adaptive.served),
      switchesFixed: fixed.switches,
      switchesAdaptive: adaptive.switches,
    },
  };
}
