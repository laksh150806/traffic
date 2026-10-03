/**
 * In-browser stand-in for the Supabase backend.
 *
 * Runs the same rules the server functions run (shared via sim-core and
 * traffic-model) against an in-memory copy of the network, so the dashboard is
 * fully alive with no database. Client-side only: nothing here touches I/O.
 */
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import { FIXED_GREEN, clamp, solveJunction, type ApproachInput } from "@/lib/traffic-model";
import {
  approachPressure,
  decidePhase,
  greenSecondsHeld,
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
  ModelPerformance,
  RoadState,
} from "@/lib/traffic-types";

const DIRECTIONS = ["NORTH", "SOUTH", "EAST", "WEST"] as const;
const NOMINAL_TICK_SEC = 12;
const WARMUP_TICKS = 30;
const HISTORY_ROWS_PER_JUNCTION = 80;
const MAX_ACCURACY_SAMPLES = 1500;
const MAX_CCTV_ROWS = 800;

type Road = {
  roadId: number;
  junctionId: number;
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
  phaseStartMs: number;
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

export type ScenarioMode = "auto" | "rush" | "night";

type World = {
  roads: Road[];
  roadsByJunction: Map<number, Road[]>;
  sim: Map<number, RoadSim>;
  cycle: Map<number, number>;
  history: Map<number, HistoryRow[]>;
  accuracy: number[];
  cctv: CctvRow[];
  frames: Map<number, number>;
  savedTotalSec: number;
  lastTickMs: number;
};

let world: World | null = null;

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
        direction,
        capacity: junction.capacity,
        name: `${junction.name} - ${titleCase(direction)} Approach`,
      };
      roads.push(road);
      list.push(road);
      const seedQueue = 20 + ((road.roadId * 13) % 55);
      sim.set(road.roadId, {
        queueExact: seedQueue,
        queue: seedQueue,
        recordedAtMs: nowMs,
        model: null,
        greenSec: 30,
        isGreen: direction === "NORTH",
        phaseStartMs: nowMs,
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
    cctv: [],
    frames: new Map(),
    savedTotalSec: 0,
    lastTickMs: nowMs,
  };
}

function ensureWorld(): World {
  if (world) return world;
  const now = Date.now();
  world = buildWorld(now - WARMUP_TICKS * NOMINAL_TICK_SEC * 1000);
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
  if (scenario.mode === "rush") return 1.9;
  if (scenario.mode === "night") return 0.45;
  return timeOfDayFactor(new Date(nowMs));
}

function incidentBoost(junctionId: number, nowMs: number) {
  const until = scenario.incidents.get(junctionId);
  if (until === undefined) return 1;
  if (until <= nowMs) {
    scenario.incidents.delete(junctionId);
    return 1;
  }
  return 2.6;
}

export function getScenarioMode(): ScenarioMode {
  return scenario.mode;
}

export function setScenarioMode(mode: ScenarioMode) {
  scenario.mode = mode;
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

    const greenSeconds = greenSecondsHeld(state.isGreen, elapsed, state.model?.green_sec);
    greenSecondsByRoad.set(road.roadId, greenSeconds);

    const step = stepQueue({
      roadId: road.roadId,
      maxCapacity: road.capacity,
      factor,
      elapsedSec: elapsed,
      priorExact: state.queueExact,
      greenSeconds,
      demandBoost: incidentBoost(road.junctionId, nowMs),
    });
    measured.set(road.roadId, step.measuredArrivals);
    exacts.set(road.roadId, Number(step.exact.toFixed(2)));
    queues.set(road.roadId, step.queue);
  }

  // Score the previous prediction against what was just observed.
  for (const road of w.roads) {
    const state = w.sim.get(road.roadId);
    if (!state?.model || !hadModel.has(road.roadId)) continue;
    const actual = queues.get(road.roadId) ?? 0;
    w.accuracy.push(Math.abs(state.model.predicted_queue_next - actual));
  }
  if (w.accuracy.length > MAX_ACCURACY_SAMPLES) {
    w.accuracy.splice(0, w.accuracy.length - MAX_ACCURACY_SAMPLES);
  }

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
    }));

    const solution = solveJunction(inputs, elapsed);
    const cycleNo = (w.cycle.get(junctionId) ?? 0) + 1;
    w.cycle.set(junctionId, cycleNo);

    // The approach nearest capacity gets the running green.
    let greenNowRoad = solution.approaches[0]?.roadId ?? -1;
    let worst = -1;
    for (const approach of solution.approaches) {
      if (approach.degreeSaturation > worst) {
        worst = approach.degreeSaturation;
        greenNowRoad = approach.roadId;
      }
    }

    const rows = w.history.get(junctionId) ?? [];
    for (const approach of solution.approaches) {
      const state = w.sim.get(approach.roadId);
      if (!state) continue;

      const dischargeNext =
        approach.roadId === greenNowRoad
          ? (approach.saturationFlowVph / 3600) * Math.min(elapsed, approach.green)
          : 0;
      const predictedNext = Math.max(
        0,
        Math.round(approach.queue + (approach.arrivalRateVph / 3600) * elapsed - dischargeNext),
      );

      state.queueExact = exacts.get(approach.roadId) ?? approach.queue;
      state.queue = approach.queue;
      state.recordedAtMs = nowMs;
      state.greenSec = approach.green;
      if (!state.isGreen) state.phaseStartMs = nowMs;
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

      const saved = Math.max(0, approach.savedVehicleSeconds);
      w.savedTotalSec += saved;
      rows.push({
        junction_id: junctionId,
        road_id: approach.roadId,
        cycle_number: cycleNo,
        allocated_green_sec: approach.green,
        baseline_fixed_sec: FIXED_GREEN,
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

  // CCTV as a second, noisier measurement of the same queue.
  const picked = w.roads.filter(() => Math.random() < 0.25).slice(0, 24);
  for (const road of picked) {
    if (isOffline(road.roadId)) continue;
    const queue = queues.get(road.roadId) ?? 20;
    const frame = (w.frames.get(road.roadId) ?? 0) + 1;
    w.frames.set(road.roadId, frame);
    w.cctv.push({
      cameraId: road.roadId,
      junctionId: road.junctionId,
      frame,
      detected: clamp(Math.round(queue * (0.88 + Math.random() * 0.24)), 0, 200),
      confidence: Number((0.82 + Math.random() * 0.16).toFixed(3)),
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

export function demoTick(nowMs = Date.now()) {
  const w = ensureWorld();
  runTick(w, nowMs);
  return { ok: true, cycles: w.roadsByJunction.size, at: new Date(nowMs).toISOString() };
}

export function demoAdvance(nowMs = Date.now()) {
  const w = ensureWorld();
  return { ok: true, switched: runAdvance(w, nowMs) };
}

// ---------------------------------------------------------------------------
// Reads (same shapes the Supabase data layer returns)
// ---------------------------------------------------------------------------

function levelFor(avgSaturation: number): CongestionLevel {
  if (avgSaturation >= 0.95) return "HIGH";
  if (avgSaturation >= 0.75) return "MODERATE";
  return "LOW";
}

export function demoFetchJunctions(): JunctionSummary[] {
  const w = ensureWorld();
  return SEED_JUNCTIONS.map((junction) => {
    const roads = w.roadsByJunction.get(junction.id) ?? [];
    const states = roads.map((r) => w.sim.get(r.roadId)).filter((s): s is RoadSim => !!s);
    const total = states.reduce((sum, s) => sum + s.queue, 0);
    const avgSat =
      states.reduce((sum, s) => sum + (s.model?.degree_saturation ?? 0), 0) /
      Math.max(states.length, 1);
    return {
      junction_id: junction.id,
      name: junction.name,
      zone: junction.zone,
      latitude: junction.lat,
      longitude: junction.lng,
      avg_vehicle_count: Number((total / Math.max(states.length, 1)).toFixed(1)),
      total_vehicle_count: total,
      congestion_level: levelFor(avgSat),
      last_reading_at: new Date(w.lastTickMs).toISOString(),
    };
  });
}

export function demoFetchRoadStates(junctionId: number): RoadState[] {
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

export function demoFetchCycleComparison(junctionId: number): CyclePoint[] {
  const w = ensureWorld();
  return aggregateCycleRows(w.history.get(junctionId) ?? []);
}

export function demoFetchJunctionModel(junctionId: number): ApproachModelState[] {
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

export function demoFetchModelPerformance(): ModelPerformance {
  const w = ensureWorld();
  const states = w.roads.map((r) => w.sim.get(r.roadId)?.model).filter((m): m is ModelRow => !!m);
  return computeModelPerformance(w.accuracy, states);
}

export function demoFetchTotalSecondsSaved(): number {
  return Math.round(ensureWorld().savedTotalSec);
}

export function demoFetchCctvFeed(junctionId: number): CctvPoint[] {
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

export function demoFetchCameraTiles(junctionId: number): CameraTile[] {
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
