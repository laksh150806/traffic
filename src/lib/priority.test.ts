import { beforeEach, describe, expect, it } from "vitest";
import {
  cancelPriorityRun,
  clearOperatorOverride,
  clearRoadIncident,
  getEvents,
  getIncidentEnds,
  getOperatorOverrides,
  getPriorityRun,
  getRoadIncidents,
  getSignalPlans,
  OPERATOR_MAX_SEC,
  reportRoadIncident,
  resetSimEngine,
  setOperatorOverride,
  simAdvance,
  setScenarioMode,
  simFetchJunctionModel,
  simFetchRoadStates,
  simTick,
  startPriorityRun,
} from "@/lib/sim-engine";
import { decideForcedPhase, MIN_PHASE_SEC, type PhaseApproach } from "@/lib/sim-core";
import { greenWindows, projectDrive, runStops, RUN_SETTINGS } from "@/lib/priority-run";
import { haversineM, junctionsAlongRoute, type LngLat } from "@/lib/routing";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";

let clock = Date.now() + 60_000;
/** Control steps taken so far; a tick follows every sixth, as in the app (12 s per tick). */
let steps = 0;

/** Advance the controller in its real 2-second steps, with a control tick every 12 seconds. */
function runSeconds(seconds: number) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 2) {
    clock += 2000;
    steps += 1;
    if (steps % 6 === 0) simTick(clock);
    simAdvance(clock);
  }
}

const greenRoad = (junctionId: number) =>
  simFetchRoadStates(junctionId).find((r) => r.is_currently_green)?.road_id;

beforeEach(() => {
  resetSimEngine(77);
  clock = Date.now() + 60_000;
  steps = 0;
  simTick(clock);
});

describe("decideForcedPhase", () => {
  const row = (roadId: number, isGreen: boolean, startedAtMs: number): PhaseApproach => ({
    roadId,
    isGreen,
    startedAtMs,
    allocatedGreen: 30,
    pressure: 0,
  });
  const now = 1_000_000;

  it("does nothing when the approach already has the green", () => {
    expect(decideForcedPhase([row(1, true, now - 60_000), row(2, false, 0)], 1, now, 8)).toBeNull();
  });

  it("will not cut a green short inside its safety floor", () => {
    const approaches = [row(1, true, now - 3000), row(2, false, 0)];
    expect(decideForcedPhase(approaches, 2, now, 8)).toBeNull();
    expect(decideForcedPhase(approaches, 2, now + 6000, 8)?.startRoadId).toBe(2);
  });

  it("ends the running green and starts the requested one", () => {
    const d = decideForcedPhase([row(1, true, now - 20_000), row(2, false, 0)], 2, now, 8);
    expect(d).toMatchObject({ endRoadId: 1, startRoadId: 2 });
  });

  it("ignores an approach that is not at the junction", () => {
    expect(decideForcedPhase([row(1, true, 0)], 9, now, 8)).toBeNull();
  });
});

describe("operator override", () => {
  const junction = SEED_JUNCTIONS[3]!;
  const roads = [1, 2, 3, 4].map((a) => 3 * 4 + a);

  it("moves the green to the chosen approach and holds it until the time is up", () => {
    runSeconds(40);
    const current = greenRoad(junction.id);
    const target = roads.find((id) => id !== current)!;
    expect(setOperatorOverride(junction.id, target, 60, clock)).toBe(true);

    runSeconds(20); // past the safety floor of whatever was running
    expect(greenRoad(junction.id)).toBe(target);
    runSeconds(30);
    expect(greenRoad(junction.id)).toBe(target);

    runSeconds(40); // the 60 s are over
    expect(getOperatorOverrides(clock)).toHaveLength(0);
    expect(getEvents(10).some((e) => e.text.startsWith("Override ended"))).toBe(true);
  });

  it("keeps one green per junction throughout", () => {
    runSeconds(30);
    const target = roads.find((id) => id !== greenRoad(junction.id))!;
    setOperatorOverride(junction.id, target, 90, clock);
    for (let i = 0; i < 40; i += 1) {
      runSeconds(2);
      expect(simFetchRoadStates(junction.id).filter((r) => r.is_currently_green)).toHaveLength(1);
    }
  });

  it("refuses an approach from another junction and clamps absurd durations", () => {
    expect(setOperatorOverride(junction.id, 1, 60, clock)).toBe(false);
    expect(setOperatorOverride(junction.id, roads[0]!, 99_999, clock)).toBe(true);
    const held = getOperatorOverrides(clock)[0]!;
    expect(held.untilMs - held.sinceMs).toBe(OPERATOR_MAX_SEC * 1000);
  });

  it("releases at once on request", () => {
    setOperatorOverride(junction.id, roads[1]!, 60, clock);
    clearOperatorOverride(junction.id, clock);
    expect(getOperatorOverrides(clock)).toHaveLength(0);
  });
});

describe("reported road problems", () => {
  const junction = SEED_JUNCTIONS[10]!;
  const road = 10 * 4 + 1;

  it("marks the junction and lifts when cleared", () => {
    expect(reportRoadIncident(road, "accident", 300, clock)).toBe(true);
    expect(getRoadIncidents(clock)).toHaveLength(1);
    expect(getIncidentEnds(clock).has(junction.id)).toBe(true);
    clearRoadIncident(road, clock);
    expect(getRoadIncidents(clock)).toHaveLength(0);
    expect(getIncidentEnds(clock).has(junction.id)).toBe(false);
  });

  it("cuts the approach's discharge capacity compared with no report", () => {
    const saturation = (report: boolean) => {
      resetSimEngine(5);
      // A forced scenario, so the result does not depend on the hour the tests happen to run.
      setScenarioMode("rush");
      clock = Date.now() + 60_000;
      steps = 0;
      simTick(clock);
      if (report) reportRoadIncident(road, "accident", 3000, clock);
      runSeconds(120);
      return simFetchJunctionModel(junction.id).find((m) => m.road_id === road)!
        .saturation_flow_vph;
    };
    expect(saturation(true)).toBeLessThan(saturation(false));
  });

  it("rejects a road that does not exist", () => {
    expect(reportRoadIncident(9999, "works", 60, clock)).toBe(false);
  });
});

/** A route through the three junctions nearest the first one, in driving order. */
function nearbyRoute() {
  const a = SEED_JUNCTIONS[0]!;
  const rest = SEED_JUNCTIONS.slice(1)
    .map((j) => ({ j, d: haversineM([a.lng, a.lat], [j.lng, j.lat]) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 2)
    .map((x) => x.j);
  const coordinates: LngLat[] = [a, ...rest].map((j) => [j.lng, j.lat]);
  const stops = runStops(
    junctionsAlongRoute(
      coordinates,
      SEED_JUNCTIONS.map((j) => ({ id: j.id, name: j.name, lat: j.lat, lng: j.lng })),
    ),
  );
  return { coordinates, stops };
}

describe("priority run", () => {
  it("finds the signals to clear and leaves out the one it starts at", () => {
    const { stops } = nearbyRoute();
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(stops.every((s) => s.alongM >= 30)).toBe(true);
    expect(new Set(stops.map((s) => s.roadId)).size).toBe(stops.length);
  });

  it("gives an ambulance the green at each signal as it arrives, and releases it after", () => {
    const { coordinates, stops } = nearbyRoute();
    runSeconds(40);
    startPriorityRun({ kind: "ambulance", label: "Ambulance", coordinates, stops }, clock);

    const seenGreen = new Set<number>();
    for (let i = 0; i < 400; i += 1) {
      runSeconds(2);
      const status = getPriorityRun(clock);
      if (!status) break;
      for (const stop of status.stops) {
        const state = simFetchRoadStates(stop.junctionId).filter((r) => r.is_currently_green);
        expect(state).toHaveLength(1);
        if (stop.phase === "clearing" && state[0]?.road_id === stop.roadId)
          seenGreen.add(stop.roadId);
      }
      if (status.finished) break;
    }

    const done = getPriorityRun(clock)!;
    expect(done.finished).toBe(true);
    expect(done.passed).toBe(stops.length);
    // Every signal on the route showed green for the ambulance while it was approaching.
    expect(seenGreen.size).toBe(stops.length);
    expect(done.savedSec).toBeGreaterThanOrEqual(0);
    expect(done.etaSec).toBe(0);
  });

  it("is shown faster when asked, and starts clearing signals further out", () => {
    const { coordinates, stops } = nearbyRoute();
    startPriorityRun(
      { kind: "wave", label: "Green wave", coordinates, stops, speedFactor: 4 },
      clock,
    );
    const after = getPriorityRun(clock + 10_000)!;
    expect(after.speedFactor).toBe(4);
    expect(after.progressM).toBeCloseTo(RUN_SETTINGS.wave.speedMps * 10 * 4, 0);
  });

  it("moves along its route at the speed set for its kind", () => {
    const { coordinates, stops } = nearbyRoute();
    startPriorityRun({ kind: "wave", label: "Green wave", coordinates, stops }, clock);
    const after = getPriorityRun(clock + 10_000)!;
    expect(after.progressM).toBeCloseTo(RUN_SETTINGS.wave.speedMps * 10, 0);
    cancelPriorityRun(clock);
    expect(getPriorityRun(clock)).toBeNull();
  });
});

describe("projecting a drive", () => {
  it("lists the green windows of an approach that is green now", () => {
    const now = 5_000_000;
    const windows = greenWindows(
      { isGreen: true, phaseStartMs: now, greenSec: 30, cycleSec: 60 },
      now,
      130,
    );
    expect(windows[0]).toEqual({ startSec: 4, endSec: 30 });
    expect(windows[1]).toEqual({ startSec: 64, endSec: 90 });
  });

  it("places the next green of an approach that is red", () => {
    const now = 5_000_000;
    const [first] = greenWindows(
      { isGreen: false, phaseStartMs: now - 10_000, greenSec: 20, cycleSec: 60 },
      now,
      100,
    );
    expect(first).toEqual({ startSec: 34, endSec: 50 });
  });

  it("charges a stop only where the vehicle meets red", () => {
    const now = 5_000_000;
    const plan = { isGreen: true, phaseStartMs: now, greenSec: 30, cycleSec: 60 };
    const stops = [
      { junctionId: 1, name: "A", roadId: 1, alongM: 100 },
      { junctionId: 2, name: "B", roadId: 5, alongM: 400 },
    ];
    const result = projectDrive(
      stops,
      new Map([
        [1, plan],
        [5, plan],
      ]),
      now,
      10,
    );
    // Reaches A at 10 s (green), B at 40 s (red until 64 s).
    expect(result.rows[0]?.waitSec).toBe(0);
    expect(result.rows[1]?.waitSec).toBe(24);
    expect(result.stopsMade).toBe(1);
    expect(result.waitSec).toBe(24);
  });

  it("reads plans from the running engine", () => {
    const plans = getSignalPlans([1, 2, 3, 4]);
    expect(plans.size).toBe(4);
    expect([...plans.values()].filter((p) => p.isGreen)).toHaveLength(1);
    expect(MIN_PHASE_SEC).toBeGreaterThan(0);
  });
});
