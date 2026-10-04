/**
 * In-browser stand-in for the Supabase backend.
 *
 * Runs the same rules the server functions run (shared via sim-core and
 * traffic-model) against an in-memory copy of the network, so the dashboard is
 * fully alive with no database. Client-side only: nothing here touches I/O.
 */
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import { fixedPlanForJunction } from "@/lib/fixed-plan";
import { forecastJunction } from "@/lib/forecast";
import { FIXED_GREEN, clamp, solveJunction, type ApproachInput } from "@/lib/traffic-model";
import {
  INCIDENT_CAPACITY_FACTOR,
  RAIN_CAPACITY_FACTOR,
  approachPressure,
  decidePhase,
  effectiveGreenSeconds,
  incidentRoadId,
  levelFor,
  stepQueue,
  timeOfDayFactor,
  type PhaseApproach,
} from "@/lib/sim-core";
import {
  aggregateCycleRows,
  computeModelPerformance,
  directionRank,
  type CycleRow,
} from "@/lib/traffic-aggregate";
import type {
  ApproachModelState,
  CameraTile,
  CctvPoint,
  CongestionLevel,
  CyclePoint,
  JunctionSummary,
  ModelledSaving,
  ModelPerformance,
  RoadState,
} from "@/lib/traffic-types";

const DIRECTIONS = ["NORTH", "SOUTH", "EAST", "WEST"] as const;
const NOMINAL_TICK_SEC = 12;
const WARMUP_TICKS = 30;
const HISTORY_ROWS_PER_JUNCTION = 80;
const MAX_ACCURACY_SAMPLES = 1500;
/** Window the "waiting avoided" total covers, minutes. */
const SAVING_WINDOW_MIN = 60;
const MAX_CCTV_ROWS = 800;

type Road = {
  roadId: number;
  junctionId: number;
  junctionIndex: number;
  direction: (typeof DIRECTIONS)[number];
  capacity: number;
  name: string;
};

type ModelRow = {
  arrival_rate_vph: number;
  saturation_flow_vph: number;
  flow_ratio: number;
  degree_saturation: number;
  green_sec: number;
  cycle_length_sec: number;
  queue_now: number;
  queue_exact: number;
  predicted_queue_next: number;
  predicted_delay_adaptive_sec: number;
  predicted_delay_fixed_sec: number;
  queue_clears: boolean;
  updatedAtMs: number;
};

type RoadSim = {
  queueExact: number;
  queue: number;
  recordedAtMs: number;
  model: ModelRow | null;
  greenSec: number;
  isGreen: boolean;
  /** When the current phase state (green or red) began. */
  phaseStartMs: number;
  /** Useful green seconds served since the last control tick. */
  greenAccumSec: number;
  /** Time up to which green has been accounted for. */
  accruedAtMs: number;
};

type HistoryRow = CycleRow & { junction_id: number; road_id: number };

type CctvRow = {
  cameraId: number;
  junctionId: number;
  frame: number;
  detected: number;
  confidence: number;
  atMs: number;
};

export type ScenarioMode = "auto" | "rush" | "night" | "rain";

type World = {
  roads: Road[];
  roadsByJunction: Map<number, Road[]>;
  sim: Map<number, RoadSim>;
  cycle: Map<number, number>;
  history: Map<number, HistoryRow[]>;
  accuracy: number[];
  /** Errors of the naive "queue stays put" guess over the same samples. */
  baseline: number[];
  /** Modelled saving per control tick, network-wide, newest last. */
  savedLog: Array<{ atMs: number; sec: number }>;
  cctv: CctvRow[];
  frames: Map<number, number>;
  lastTickMs: number;
};

let world: World | null = null;

/** Source of randomness for the simulator. Replaceable so tests can be exactly repeatable. */
let random: () => number = Math.random;

/** Small seeded generator (mulberry32). */
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Start the simulation again from scratch. With a seed the random noise is repeatable;
 * without one it is ordinary randomness. Mostly for tests.
 */
export function resetSimEngine(seed?: number) {
  world = null;
  scenario.mode = "auto";
  scenario.incidents.clear();
  random = seed === undefined ? Math.random : seededRandom(seed);
}

const scenario = {
  mode: "auto" as ScenarioMode,
  incidents: new Map<number, number>(),
};

const pad3 = (n: number) => String(n).padStart(3, "0");
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function buildWorld(nowMs: number): World {
  const roads: Road[] = [];
  const roadsByJunction = new Map<number, Road[]>();
  const sim = new Map<number, RoadSim>();

  SEED_JUNCTIONS.forEach((junction, jIndex) => {
    const list: Road[] = [];
    DIRECTIONS.forEach((direction, dIndex) => {
      const road: Road = {
        roadId: jIndex * DIRECTIONS.length + dIndex + 1,
        junctionId: junction.id,
        junctionIndex: jIndex,
        direction,
        capacity: junction.capacity,
        name: `${junction.name} - ${titleCase(direction)} Approach`,
      };
      roads.push(road);
      list.push(road);
      sim.set(road.roadId, {
        queueExact: 0,
        queue: 0,
        recordedAtMs: nowMs,
        model: null,
        greenSec: 30,
        isGreen: direction === "NORTH",
        phaseStartMs: nowMs,
        greenAccumSec: 0,
        accruedAtMs: nowMs,
      });
    });
    roadsByJunction.set(junction.id, list);
  });

  return {
    roads,
    roadsByJunction,
    sim,
    cycle: new Map(),
    history: new Map(),
    accuracy: [],
    baseline: [],
    savedLog: [],
    cctv: [],
    frames: new Map(),
    lastTickMs: nowMs,
  };
}

/**
 * Start every approach with the queue it would settle to at this hour, instead of an arbitrary
 * pile, so the first screen is not a network full of leftover vehicles that take many minutes to
 * clear.
 */
function seedQueues(w: World, nowMs: number) {
  const factor = getScenarioFactor();
  const capacityScale = getScenarioCapacity();
  SEED_JUNCTIONS.forEach((junction, jIndex) => {
    const expected = forecastJunction(jIndex, new Date(nowMs), {
      ...(factor === undefined ? {} : { factor }),
      capacityScale,
    });
    (w.roadsByJunction.get(junction.id) ?? []).forEach((road, a) => {
      const state = w.sim.get(road.roadId);
      if (!state) return;
      state.queueExact = expected.approachQueues[a] ?? 0;
      state.queue = Math.round(state.queueExact);
    });
  });
}

function ensureWorld(): World {
  if (world) return world;
  const now = Date.now();
  const start = now - WARMUP_TICKS * NOMINAL_TICK_SEC * 1000;
  world = buildWorld(start);
  seedQueues(world, start);
  // Warm start so charts and history are populated on first paint.
  for (let i = WARMUP_TICKS; i >= 1; i -= 1) {
    const t = now - i * NOMINAL_TICK_SEC * 1000;
    runTick(world, t);
    for (let k = 1; k <= NOMINAL_TICK_SEC / 2; k += 1) runAdvance(world, t + k * 2000);
  }
  return world;
}

// ---------------------------------------------------------------------------
// Scenario controls
// ---------------------------------------------------------------------------

function demandFactor(nowMs: number) {
  return getScenarioFactor() ?? timeOfDayFactor(new Date(nowMs));
}

/**
 * Share of capacity the road has left: wet roads cut every approach, and a blocked lane cuts the
 * busiest arm of its junction as well.
 */
function capacityFactorFor(road: Road, nowMs: number) {
  const wet = getScenarioCapacity();
  const until = scenario.incidents.get(road.junctionId);
  if (until === undefined) return wet;
  if (until <= nowMs) {
    scenario.incidents.delete(road.junctionId);
    return wet;
  }
  return wet * (road.roadId === incidentRoadId(road.junctionIndex) ? INCIDENT_CAPACITY_FACTOR : 1);
}

/** The capacity share a forced scenario applies to every approach (rain), or 1. */
export function getScenarioCapacity(): number {
  return scenario.mode === "rain" ? RAIN_CAPACITY_FACTOR : 1;
}

/** Count green seconds for every approach that is currently green, up to nowMs. */
function accrueGreen(w: World, nowMs: number) {
  for (const state of w.sim.values()) {
    if (nowMs <= state.accruedAtMs) continue;
    if (state.isGreen) {
      state.greenAccumSec += effectiveGreenSeconds(state.phaseStartMs, state.accruedAtMs, nowMs);
    }
    state.accruedAtMs = nowMs;
  }
}

/** The demand multiplier a forced scenario applies, or undefined when the clock decides. */
export function getScenarioFactor(): number | undefined {
  if (scenario.mode === "rush") return 1.9;
  if (scenario.mode === "night") return 0.45;
  return undefined;
}

/** Blocked-lane junctions with the time (ms) each block clears. */
export function getIncidentEnds(nowMs = Date.now()): Map<number, number> {
  return new Map([...scenario.incidents.entries()].filter(([, until]) => until > nowMs));
}

export function getScenarioMode(): ScenarioMode {
  return scenario.mode;
}

export function setScenarioMode(mode: ScenarioMode) {
  scenario.mode = mode;
  // Traffic does not take half an hour to arrive when a rush hour is switched on: queues jump
  // to what that scenario settles at, and the controller then reacts from there.
  if (world) seedQueues(world, Date.now());
}

/** Spike demand at one junction for a while, as if a lane were blocked. */
export function triggerIncident(junctionId: number, seconds = 150, nowMs = Date.now()) {
  scenario.incidents.set(junctionId, nowMs + seconds * 1000);
}

export function clearIncidents() {
  scenario.incidents.clear();
}

export function getActiveIncidents(nowMs = Date.now()): number[] {
  return [...scenario.incidents.entries()].filter(([, until]) => until > nowMs).map(([id]) => id);
}

// ---------------------------------------------------------------------------
// Control tick (mirrors runTrafficTick)
// ---------------------------------------------------------------------------

function runTick(w: World, nowMs: number) {
  accrueGreen(w, nowMs);
  const factor = demandFactor(nowMs);
  const prevExact = new Map<number, number>();
  const prevArrival = new Map<number, number | null>();
  const hadModel = new Set<number>();
  const elapsedByRoad = new Map<number, number>();
  const greenSecondsByRoad = new Map<number, number>();
  const measured = new Map<number, number>();
  const queues = new Map<number, number>();
  const exacts = new Map<number, number>();

  for (const road of w.roads) {
    const state = w.sim.get(road.roadId);
    if (!state) continue;
    const elapsed = state.model
      ? clamp((nowMs - state.model.updatedAtMs) / 1000, 4, 120)
      : NOMINAL_TICK_SEC;
    elapsedByRoad.set(road.roadId, elapsed);
    prevExact.set(road.roadId, state.queueExact);
    prevArrival.set(road.roadId, state.model ? state.model.arrival_rate_vph : null);
    if (state.model) hadModel.add(road.roadId);

    // Green actually served since the last tick, after the lost time at each phase start.
    const greenSeconds = state.greenAccumSec;
    state.greenAccumSec = 0;
    greenSecondsByRoad.set(road.roadId, greenSeconds);

    const step = stepQueue({
      roadId: road.roadId,
      maxCapacity: road.capacity,
      factor,
      elapsedSec: elapsed,
      priorExact: state.queueExact,
      greenSeconds,
      capacityFactor: capacityFactorFor(road, nowMs),
      rand: random,
    });
    measured.set(road.roadId, step.measuredArrivals);
    exacts.set(road.roadId, Number(step.exact.toFixed(2)));
    queues.set(road.roadId, step.queue);
  }

  // Score the previous prediction against what was just observed, and against
  // the naive guess that nothing changes.
  for (const road of w.roads) {
    const state = w.sim.get(road.roadId);
    if (!state?.model || !hadModel.has(road.roadId)) continue;
    const actual = queues.get(road.roadId) ?? 0;
    w.accuracy.push(Math.abs(state.model.predicted_queue_next - actual));
    w.baseline.push(Math.abs(state.model.queue_now - actual));
  }
  if (w.accuracy.length > MAX_ACCURACY_SAMPLES) {
    w.accuracy.splice(0, w.accuracy.length - MAX_ACCURACY_SAMPLES);
    w.baseline.splice(0, w.baseline.length - MAX_ACCURACY_SAMPLES);
  }
  let tickSaved = 0;

  // Solve every junction.
  for (const [junctionId, roads] of w.roadsByJunction) {
    const elapsed =
      roads.reduce((sum, r) => sum + (elapsedByRoad.get(r.roadId) ?? NOMINAL_TICK_SEC), 0) /
      roads.length;

    const inputs: ApproachInput[] = roads.map((road) => ({
      roadId: road.roadId,
      queue: queues.get(road.roadId) ?? 0,
      previousQueue: Math.round(prevExact.get(road.roadId) ?? 0),
      previousGreen: greenSecondsByRoad.get(road.roadId) ?? 0,
      previousArrivalRate: prevArrival.get(road.roadId) ?? null,
      measuredArrivals: measured.get(road.roadId) ?? null,
      maxCapacity: road.capacity,
      capacityFactor: capacityFactorFor(road, nowMs),
    }));

    const fixedPlan = fixedPlanForJunction(junctionId);
    const solution = solveJunction(inputs, elapsed, fixedPlan);
    const cycleNo = (w.cycle.get(junctionId) ?? 0) + 1;
    w.cycle.set(junctionId, cycleNo);

    const rows = w.history.get(junctionId) ?? [];
    for (const [approachIndex, approach] of solution.approaches.entries()) {
      const state = w.sim.get(approach.roadId);
      if (!state) continue;

      // Expected discharge over the next window: the approach is green for
      // green/cycle of the time, whichever phase the controller picks next.
      const dischargeNext =
        (approach.saturationFlowVph / 3600) * elapsed * (approach.green / solution.cycleLength);
      const predictedNext = Math.max(
        0,
        Math.round(approach.queue + (approach.arrivalRateVph / 3600) * elapsed - dischargeNext),
      );

      state.queueExact = exacts.get(approach.roadId) ?? approach.queue;
      state.queue = approach.queue;
      state.recordedAtMs = nowMs;
      state.greenSec = approach.green;
      state.model = {
        arrival_rate_vph: approach.arrivalRateVph,
        saturation_flow_vph: approach.saturationFlowVph,
        flow_ratio: approach.flowRatio,
        degree_saturation: approach.degreeSaturation,
        green_sec: approach.green,
        cycle_length_sec: solution.cycleLength,
        queue_now: approach.queue,
        queue_exact: state.queueExact,
        predicted_queue_next: predictedNext,
        predicted_delay_adaptive_sec: approach.delayAdaptive,
        predicted_delay_fixed_sec: approach.delayFixed,
        queue_clears: approach.queueClears,
        updatedAtMs: nowMs,
      };

      const saved = approach.savedVehicleSeconds;
      tickSaved += saved;
      rows.push({
        junction_id: junctionId,
        road_id: approach.roadId,
        cycle_number: cycleNo,
        allocated_green_sec: approach.green,
        baseline_fixed_sec: fixedPlan?.greens[approachIndex] ?? FIXED_GREEN,
        estimated_wait_saved_sec: saved,
        predicted_delay_adaptive_sec: approach.delayAdaptive,
        predicted_delay_fixed_sec: approach.delayFixed,
      });
    }
    if (rows.length > HISTORY_ROWS_PER_JUNCTION) {
      rows.splice(0, rows.length - HISTORY_ROWS_PER_JUNCTION);
    }
    w.history.set(junctionId, rows);
  }

  w.savedLog.push({ atMs: nowMs, sec: tickSaved });
  const cutoff = nowMs - SAVING_WINDOW_MIN * 60_000;
  while (w.savedLog.length > 1 && (w.savedLog[0]?.atMs ?? nowMs) < cutoff) w.savedLog.shift();

  // CCTV as a second, noisier measurement of the same queue.
  const picked = w.roads.filter(() => random() < 0.25).slice(0, 24);
  for (const road of picked) {
    if (isOffline(road.roadId)) continue;
    const queue = queues.get(road.roadId) ?? 20;
    const frame = (w.frames.get(road.roadId) ?? 0) + 1;
    w.frames.set(road.roadId, frame);
    w.cctv.push({
      cameraId: road.roadId,
      junctionId: road.junctionId,
      frame,
      detected: clamp(Math.round(queue * (0.88 + random() * 0.24)), 0, 200),
      confidence: Number((0.82 + random() * 0.16).toFixed(3)),
      atMs: nowMs,
    });
  }
  if (w.cctv.length > MAX_CCTV_ROWS) w.cctv.splice(0, w.cctv.length - MAX_CCTV_ROWS);

  w.lastTickMs = nowMs;
}

/** A few cameras are deliberately offline so the wall shows a lost-signal state. */
function isOffline(roadId: number) {
  return roadId % 37 === 0;
}

// ---------------------------------------------------------------------------
// Real-time phase controller (mirrors advanceSignals)
// ---------------------------------------------------------------------------

function runAdvance(w: World, nowMs: number): number {
  accrueGreen(w, nowMs);
  let switched = 0;
  for (const roads of w.roadsByJunction.values()) {
    const approaches: PhaseApproach[] = [];
    for (const road of roads) {
      const state = w.sim.get(road.roadId);
      if (!state) continue;
      approaches.push({
        roadId: road.roadId,
        isGreen: state.isGreen,
        startedAtMs: state.phaseStartMs,
        allocatedGreen: state.model?.green_sec ?? state.greenSec,
        pressure: approachPressure(
          state.model
            ? { degreeSaturation: state.model.degree_saturation, queueNow: state.model.queue_now }
            : null,
        ),
      });
    }

    const decision = decidePhase(approaches, nowMs);
    if (!decision) continue;

    const ending = decision.endRoadId === null ? undefined : w.sim.get(decision.endRoadId);
    if (ending) {
      ending.isGreen = false;
      ending.phaseStartMs = nowMs;
      switched += 1;
    }
    const starting = w.sim.get(decision.startRoadId);
    if (starting) {
      starting.isGreen = true;
      starting.greenSec = decision.startGreen;
      starting.phaseStartMs = nowMs;
      switched += 1;
    }
  }
  return switched;
}

export function simTick(nowMs = Date.now()) {
  const w = ensureWorld();
  runTick(w, nowMs);
  return { ok: true, cycles: w.roadsByJunction.size, at: new Date(nowMs).toISOString() };
}

export function simAdvance(nowMs = Date.now()) {
  const w = ensureWorld();
  return { ok: true, switched: runAdvance(w, nowMs) };
}

// ---------------------------------------------------------------------------
// Reads (same shapes the Supabase data layer returns)
// ---------------------------------------------------------------------------

export function simFetchJunctions(): JunctionSummary[] {
  const w = ensureWorld();
  return SEED_JUNCTIONS.map((junction) => {
    const roads = w.roadsByJunction.get(junction.id) ?? [];
    const states = roads.map((r) => w.sim.get(r.roadId)).filter((s): s is RoadSim => !!s);
    const total = states.reduce((sum, s) => sum + s.queue, 0);
    const avgSat =
      states.reduce((sum, s) => sum + (s.model?.degree_saturation ?? 0), 0) /
      Math.max(states.length, 1);
    const maxQueue = states.reduce((max, s) => Math.max(max, s.queue), 0);
    return {
      junction_id: junction.id,
      name: junction.name,
      zone: junction.zone,
      latitude: junction.lat,
      longitude: junction.lng,
      avg_vehicle_count: Number((total / Math.max(states.length, 1)).toFixed(1)),
      total_vehicle_count: total,
      congestion_level: levelFor(avgSat, maxQueue),
      last_reading_at: new Date(w.lastTickMs).toISOString(),
    };
  });
}

export function simFetchRoadStates(junctionId: number): RoadState[] {
  const w = ensureWorld();
  return (w.roadsByJunction.get(junctionId) ?? [])
    .map((road) => {
      const s = w.sim.get(road.roadId);
      return {
        road_id: road.roadId,
        direction: road.direction,
        road_name: road.name,
        max_capacity: road.capacity,
        vehicle_count: s?.queue ?? 0,
        source: "SIMULATED_SENSOR",
        recorded_at: s ? new Date(s.recordedAtMs).toISOString() : null,
        green_duration_sec: s?.greenSec ?? 30,
        timing_mode: "ADAPTIVE",
        is_currently_green: s?.isGreen ?? false,
        phase_started_at: s ? new Date(s.phaseStartMs).toISOString() : null,
      };
    })
    .sort((a, b) => directionRank(a.direction) - directionRank(b.direction));
}

export function simFetchCycleComparison(junctionId: number): CyclePoint[] {
  const w = ensureWorld();
  return aggregateCycleRows(w.history.get(junctionId) ?? []);
}

export function simFetchJunctionModel(junctionId: number): ApproachModelState[] {
  const w = ensureWorld();
  const out: ApproachModelState[] = [];
  for (const road of w.roadsByJunction.get(junctionId) ?? []) {
    const m = w.sim.get(road.roadId)?.model;
    if (!m) continue;
    out.push({
      road_id: road.roadId,
      direction: road.direction,
      arrival_rate_vph: m.arrival_rate_vph,
      saturation_flow_vph: m.saturation_flow_vph,
      degree_saturation: m.degree_saturation,
      green_sec: m.green_sec,
      cycle_length_sec: m.cycle_length_sec,
      queue_now: m.queue_now,
      predicted_queue_next: m.predicted_queue_next,
      predicted_delay_adaptive_sec: m.predicted_delay_adaptive_sec,
      predicted_delay_fixed_sec: m.predicted_delay_fixed_sec,
      queue_clears: m.queue_clears,
    });
  }
  return out.sort((a, b) => directionRank(a.direction) - directionRank(b.direction));
}

export function simFetchModelPerformance(): ModelPerformance {
  const w = ensureWorld();
  const states = w.roads.flatMap((r) => {
    const model = w.sim.get(r.roadId)?.model;
    return model ? [{ ...model, junction_id: r.junctionId }] : [];
  });
  return computeModelPerformance(w.accuracy, states, w.baseline);
}

/** Modelled waiting avoided over the last hour (or since the engine started, if shorter). */
export function simFetchTotalSecondsSaved(): ModelledSaving {
  const w = ensureWorld();
  const oldest = w.savedLog[0]?.atMs ?? w.lastTickMs;
  const spanMin = (w.lastTickMs - oldest) / 60_000 + NOMINAL_TICK_SEC / 60;
  return {
    seconds: Math.round(w.savedLog.reduce((sum, row) => sum + row.sec, 0)),
    windowMin: Math.max(1, Math.round(Math.min(SAVING_WINDOW_MIN, spanMin))),
  };
}

export function simFetchCctvFeed(junctionId: number): CctvPoint[] {
  const w = ensureWorld();
  const roads = new Map((w.roadsByJunction.get(junctionId) ?? []).map((r) => [r.roadId, r]));
  return w.cctv
    .filter((row) => row.junctionId === junctionId)
    .slice(-24)
    .map((row) => ({
      frame_number: row.frame,
      vehicles_detected: row.detected,
      confidence_avg: row.confidence,
      camera_name: `CAM-${pad3(row.cameraId)} ${roads.get(row.cameraId)?.direction ?? ""}`.trim(),
      analyzed_at: new Date(row.atMs).toISOString(),
    }));
}

export function simFetchCameraTiles(junctionId: number): CameraTile[] {
  const w = ensureWorld();
  return (w.roadsByJunction.get(junctionId) ?? [])
    .map((road) => {
      const last = [...w.cctv].reverse().find((row) => row.cameraId === road.roadId);
      return {
        camera_id: road.roadId,
        camera_name: `CAM-${pad3(road.roadId)} ${road.direction}`,
        status: isOffline(road.roadId) ? "OFFLINE" : "ONLINE",
        road_id: road.roadId,
        direction: road.direction,
        road_name: road.name,
        frame_number: last?.frame ?? w.frames.get(road.roadId) ?? 0,
        confidence_avg: last?.confidence ?? 0.9,
        analyzed_at: last ? new Date(last.atMs).toISOString() : null,
      };
    })
    .sort((a, b) => directionRank(a.direction) - directionRank(b.direction));
}
