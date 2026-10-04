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
import { cumulativeM, pointAt, type LngLat } from "@/lib/routing";
import { RUN_SETTINGS, type RunKind, type RunStop, type SignalPlan } from "@/lib/priority-run";
import {
  INCIDENT_CAPACITY_FACTOR,
  MIN_PHASE_SEC,
  RAIN_CAPACITY_FACTOR,
  approachPressure,
  decideForcedPhase,
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
  operatorOverrides.clear();
  roadIncidents.clear();
  events.length = 0;
  run = null;
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
  let factor = getScenarioCapacity();
  const until = scenario.incidents.get(road.junctionId);
  if (until !== undefined) {
    if (until <= nowMs) scenario.incidents.delete(road.junctionId);
    else if (road.roadId === incidentRoadId(road.junctionIndex)) factor *= INCIDENT_CAPACITY_FACTOR;
  }
  const report = roadIncidents.get(road.roadId);
  if (report) {
    if (report.untilMs <= nowMs) roadIncidents.delete(road.roadId);
    else factor *= ROAD_INCIDENT_FACTOR[report.kind];
  }
  return factor;
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
  const ends = new Map([...scenario.incidents.entries()].filter(([, until]) => until > nowMs));
  // A report on one road also marks its junction on the map and in the forecast (which, for the
  // future, treats the junction's busiest approach as the affected one).
  for (const report of roadIncidents.values()) {
    if (report.untilMs <= nowMs) continue;
    const junctionId = junctionIdOfRoad(report.roadId);
    if (junctionId !== undefined) {
      ends.set(junctionId, Math.max(ends.get(junctionId) ?? 0, report.untilMs));
    }
  }
  return ends;
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
  return [...getIncidentEnds(nowMs).keys()];
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export type EngineEvent = { atMs: number; text: string; tone: "info" | "good" | "warn" };

const events: EngineEvent[] = [];
const MAX_EVENTS = 40;

function logEvent(text: string, tone: EngineEvent["tone"] = "info", atMs = Date.now()) {
  events.push({ atMs, text, tone });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/** The most recent things operators and the engine did, newest first. */
export function getEvents(limit = 8): EngineEvent[] {
  return events.slice(-limit).reverse();
}

const junctionIdOfRoad = (roadId: number) => SEED_JUNCTIONS[Math.floor((roadId - 1) / 4)]?.id;
const junctionNameOf = (junctionId: number) =>
  SEED_JUNCTIONS.find((j) => j.id === junctionId)?.name ?? `Junction ${junctionId}`;

// ---------------------------------------------------------------------------
// Operator override: a person takes one junction's green for a while
// ---------------------------------------------------------------------------

export const OPERATOR_DEFAULT_SEC = 60;
export const OPERATOR_MIN_SEC = 10;
export const OPERATOR_MAX_SEC = 180;

export type OperatorOverride = {
  junctionId: number;
  roadId: number;
  sinceMs: number;
  untilMs: number;
};

const operatorOverrides = new Map<number, OperatorOverride>();

/**
 * Give one approach the green and keep it there for a while. The running green is not cut short
 * inside its safety floor, the usual amber and all-red still happen, and the override ends by
 * itself, so a forgotten one cannot freeze a junction. Returns false for an approach that is not
 * at that junction.
 */
export function setOperatorOverride(
  junctionId: number,
  roadId: number,
  seconds = OPERATOR_DEFAULT_SEC,
  nowMs = Date.now(),
): boolean {
  const w = ensureWorld();
  const road = w.roads.find((r) => r.roadId === roadId && r.junctionId === junctionId);
  if (!road) return false;
  const secs = clamp(Math.round(seconds), OPERATOR_MIN_SEC, OPERATOR_MAX_SEC);
  operatorOverrides.set(junctionId, {
    junctionId,
    roadId,
    sinceMs: nowMs,
    untilMs: nowMs + secs * 1000,
  });
  logEvent(
    `Operator gave ${titleCase(road.direction)} the green at ${junctionNameOf(junctionId)} for ${secs} s`,
    "warn",
    nowMs,
  );
  return true;
}

export function clearOperatorOverride(junctionId: number, nowMs = Date.now()) {
  if (operatorOverrides.delete(junctionId)) {
    logEvent(`Operator released ${junctionNameOf(junctionId)} to the controller`, "info", nowMs);
  }
}

export function getOperatorOverrides(nowMs = Date.now()): OperatorOverride[] {
  return [...operatorOverrides.values()].filter((o) => o.untilMs > nowMs);
}

// ---------------------------------------------------------------------------
// Reported road problems
// ---------------------------------------------------------------------------

export type RoadIncidentKind = "accident" | "works";

/** Share of an approach's capacity left under each kind of report. */
export const ROAD_INCIDENT_FACTOR: Record<RoadIncidentKind, number> = {
  accident: INCIDENT_CAPACITY_FACTOR,
  works: 0.55,
};
export const ROAD_INCIDENT_DEFAULT_SEC = 240;

export type RoadIncident = { roadId: number; kind: RoadIncidentKind; untilMs: number };

const roadIncidents = new Map<number, RoadIncident>();

/** Report an accident or road works on one approach; its capacity drops until it clears. */
export function reportRoadIncident(
  roadId: number,
  kind: RoadIncidentKind,
  seconds = ROAD_INCIDENT_DEFAULT_SEC,
  nowMs = Date.now(),
): boolean {
  const w = ensureWorld();
  const road = w.roads.find((r) => r.roadId === roadId);
  if (!road) return false;
  roadIncidents.set(roadId, { roadId, kind, untilMs: nowMs + Math.max(30, seconds) * 1000 });
  logEvent(
    `${kind === "accident" ? "Accident" : "Road works"} reported on the ${titleCase(road.direction)} approach at ${junctionNameOf(road.junctionId)}`,
    "warn",
    nowMs,
  );
  return true;
}

export function clearRoadIncident(roadId: number, nowMs = Date.now()) {
  const report = roadIncidents.get(roadId);
  if (report && roadIncidents.delete(roadId)) {
    const junctionId = junctionIdOfRoad(roadId);
    logEvent(
      `${report.kind === "accident" ? "Accident" : "Road works"} cleared${junctionId === undefined ? "" : ` at ${junctionNameOf(junctionId)}`}`,
      "good",
      nowMs,
    );
  }
}

export function getRoadIncidents(nowMs = Date.now()): RoadIncident[] {
  return [...roadIncidents.values()].filter((r) => r.untilMs > nowMs);
}

// ---------------------------------------------------------------------------
// Priority runs: an ambulance, or a platoon, that the signals turn green for in turn
// ---------------------------------------------------------------------------

type RunPhase = "ahead" | "clearing" | "passed";

type RunStopState = RunStop & {
  phase: RunPhase;
  /** Vehicles waiting on the other approaches when the priority began. */
  heldVehicles: number;
  /** What an ordinary vehicle would wait here, seconds (the model's delay for this approach). */
  normalWaitSec: number;
};

type PriorityRun = {
  kind: RunKind;
  label: string;
  startedAtMs: number;
  /** How many times faster than real time the vehicle is shown moving. */
  speedFactor: number;
  totalM: number;
  coordinates: LngLat[];
  cumulative: number[];
  stops: RunStopState[];
  finishedAtMs: number | null;
};

let run: PriorityRun | null = null;

export type PriorityRunStatus = {
  kind: RunKind;
  label: string;
  progressM: number;
  totalM: number;
  etaSec: number;
  /** 1 is real time; more shows the run faster so a long route can be watched. */
  speedFactor: number;
  finished: boolean;
  /** The route as [lng, lat] pairs. */
  coordinates: LngLat[];
  /** Where the vehicle is now, [lng, lat]. */
  position: LngLat;
  stops: Array<RunStop & { phase: RunPhase; heldVehicles: number; normalWaitSec: number }>;
  /** Waiting an ordinary vehicle would have done at the signals already reached. */
  savedSec: number;
  /** Vehicles that were queued on the other approaches while it passed. */
  heldVehicles: number;
  passed: number;
};

/** Start a run along a route. Replaces any run already going. */
export function startPriorityRun(
  input: {
    kind: RunKind;
    label: string;
    coordinates: LngLat[];
    stops: RunStop[];
    speedFactor?: number;
  },
  nowMs = Date.now(),
) {
  ensureWorld();
  const cumulative = cumulativeM(input.coordinates);
  run = {
    kind: input.kind,
    label: input.label,
    startedAtMs: nowMs,
    speedFactor: clamp(Math.round(input.speedFactor ?? 1), 1, 10),
    totalM: cumulative[cumulative.length - 1] ?? 0,
    coordinates: input.coordinates,
    cumulative,
    stops: input.stops.map((stop) => ({
      ...stop,
      phase: "ahead",
      heldVehicles: 0,
      normalWaitSec: 0,
    })),
    finishedAtMs: null,
  };
  logEvent(
    `${input.label} started: ${input.stops.length} signals on the route`,
    input.kind === "ambulance" ? "warn" : "info",
    nowMs,
  );
}

export function cancelPriorityRun(nowMs = Date.now()) {
  if (run && run.finishedAtMs === null) {
    logEvent(`${run.label} cancelled, signals back to the controller`, "info", nowMs);
  }
  run = null;
}

function runProgressM(r: PriorityRun, nowMs: number) {
  const end = r.finishedAtMs ?? nowMs;
  return clamp(
    ((end - r.startedAtMs) / 1000) * RUN_SETTINGS[r.kind].speedMps * r.speedFactor,
    0,
    r.totalM,
  );
}

export function getPriorityRun(nowMs = Date.now()): PriorityRunStatus | null {
  if (!run) return null;
  const settings = RUN_SETTINGS[run.kind];
  const progressM = runProgressM(run, nowMs);
  const reached = run.stops.filter((s) => s.phase !== "ahead");
  return {
    kind: run.kind,
    label: run.label,
    progressM,
    totalM: run.totalM,
    etaSec: Math.max(
      0,
      Math.round((run.totalM - progressM) / (settings.speedMps * run.speedFactor)),
    ),
    speedFactor: run.speedFactor,
    finished: run.finishedAtMs !== null,
    coordinates: run.coordinates,
    position: pointAt(run.coordinates, run.cumulative, progressM),
    stops: run.stops.map((s) => ({ ...s })),
    savedSec: reached.reduce((sum, s) => sum + s.normalWaitSec, 0),
    heldVehicles: reached.reduce((sum, s) => sum + s.heldVehicles, 0),
    passed: run.stops.filter((s) => s.phase === "passed").length,
  };
}

/** Move the run along and mark which signals are now clearing a path for it. */
function updateRun(w: World, nowMs: number) {
  if (!run || run.finishedAtMs !== null) return;
  const settings = RUN_SETTINGS[run.kind];
  const progress = runProgressM(run, nowMs);
  // The lead is in seconds of travel, so a run shown faster starts clearing signals further out.
  const leadM = settings.speedMps * run.speedFactor * settings.leadSec;
  for (const stop of run.stops) {
    if (stop.phase === "passed") continue;
    if (progress >= stop.alongM + settings.clearM) {
      stop.phase = "passed";
      logEvent(`${run.label} cleared ${stop.name}`, "good", nowMs);
    } else if (stop.phase === "ahead" && progress >= stop.alongM - leadM) {
      stop.phase = "clearing";
      const others = (w.roadsByJunction.get(stop.junctionId) ?? []).filter(
        (r) => r.roadId !== stop.roadId,
      );
      stop.heldVehicles = others.reduce((sum, r) => sum + (w.sim.get(r.roadId)?.queue ?? 0), 0);
      stop.normalWaitSec = Math.round(
        w.sim.get(stop.roadId)?.model?.predicted_delay_adaptive_sec ?? 0,
      );
    }
  }
  if (progress >= run.totalM) {
    for (const stop of run.stops) stop.phase = "passed";
    run.finishedAtMs = nowMs;
    logEvent(`${run.label} finished its route`, "good", nowMs);
  }
}

type PriorityTarget = { roadId: number; minGreenSec: number; untilMs: number | null };

/**
 * Who has a claim on a junction's green this step. An ambulance outranks an operator, who
 * outranks a green wave; nothing outranks the safety floor in decideForcedPhase.
 */
function priorityTarget(junctionId: number, nowMs: number): PriorityTarget | null {
  const clearing =
    run && run.finishedAtMs === null
      ? run.stops.find((s) => s.junctionId === junctionId && s.phase === "clearing")
      : undefined;
  if (run && clearing && run.kind === "ambulance") {
    return {
      roadId: clearing.roadId,
      minGreenSec: RUN_SETTINGS.ambulance.minGreenSec,
      untilMs: null,
    };
  }
  const override = operatorOverrides.get(junctionId);
  if (override) {
    if (override.untilMs <= nowMs) {
      operatorOverrides.delete(junctionId);
      logEvent(
        `Override ended at ${junctionNameOf(junctionId)}, controller back in charge`,
        "info",
        nowMs,
      );
    } else {
      return { roadId: override.roadId, minGreenSec: MIN_PHASE_SEC, untilMs: override.untilMs };
    }
  }
  if (run && clearing) {
    return {
      roadId: clearing.roadId,
      minGreenSec: RUN_SETTINGS[run.kind].minGreenSec,
      untilMs: null,
    };
  }
  return null;
}

/** What each of these approaches is doing, for projecting a drive along them. */
export function getSignalPlans(roadIds: number[]): Map<number, SignalPlan> {
  const w = ensureWorld();
  const plans = new Map<number, SignalPlan>();
  for (const roadId of roadIds) {
    const state = w.sim.get(roadId);
    if (!state) continue;
    plans.set(roadId, {
      isGreen: state.isGreen,
      phaseStartMs: state.phaseStartMs,
      greenSec: state.model?.green_sec ?? state.greenSec,
      cycleSec: state.model?.cycle_length_sec ?? 90,
    });
  }
  return plans;
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
  updateRun(w, nowMs);
  let switched = 0;
  for (const [junctionId, roads] of w.roadsByJunction) {
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

    const target = priorityTarget(junctionId, nowMs);
    if (target?.untilMs) {
      // The green an operator holds is longer than the plan's: show the time they asked for.
      const held = w.sim.get(target.roadId);
      if (held?.isGreen) {
        held.greenSec = Math.max(
          held.greenSec,
          Math.ceil((target.untilMs - held.phaseStartMs) / 1000),
        );
      }
    }
    const decision = target
      ? decideForcedPhase(approaches, target.roadId, nowMs, target.minGreenSec)
      : decidePhase(approaches, nowMs);
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
      starting.greenSec = target?.untilMs
        ? Math.max(decision.startGreen, Math.ceil((target.untilMs - nowMs) / 1000))
        : decision.startGreen;
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
