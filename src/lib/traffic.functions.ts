import { createServerFn } from "@tanstack/react-start";
import { fixedPlanForJunction } from "@/lib/fixed-plan";
import { FIXED_GREEN, clamp, solveJunction, type ApproachInput } from "@/lib/traffic-model";
import {
  INCIDENT_CAPACITY_FACTOR,
  approachPressure,
  decidePhase,
  effectiveGreenSeconds,
  stepQueue,
  timeOfDayFactor,
  type PhaseApproach,
} from "@/lib/sim-core";

/** Nominal seconds between control updates, used when no history exists yet. */
const NOMINAL_TICK_SEC = 12;
/**
 * The two loops are throttled in the database, not here: however many tabs are open or
 * however often the endpoints are hit, at most one tick runs per MIN_TICK_GAP_MS and one
 * phase update per MIN_ADVANCE_GAP_MS. Extra calls cost a single cheap RPC.
 */
const MIN_TICK_GAP_MS = 5000;
const MIN_ADVANCE_GAP_MS = 1500;
const MIN_PRUNE_GAP_MS = 60_000;

type RoadRow = { road_id: number; junction_id: number; direction: string; max_capacity: number };

type ModelStateRow = {
  road_id: number;
  arrival_rate_vph: number;
  green_sec: number;
  cycle_length_sec: number;
  queue_now: number;
  queue_exact: number;
  predicted_queue_next: number;
  updated_at: string;
};

type TimingRow = {
  timing_id: number;
  road_id: number;
  junction_id: number;
  green_duration_sec: number;
  is_currently_green: boolean;
  updated_at: string;
};

/**
 * When a scheduled worker drives the loops (CONTROL_BROWSER_DRIVEN=false), the public endpoints
 * below do nothing, so only a caller holding the secret can move the simulation.
 */
async function browserGuard<T>(run: () => Promise<T>): Promise<T | { ok: false; disabled: true }> {
  if (process.env["CONTROL_BROWSER_DRIVEN"] === "false") return { ok: false, disabled: true };
  return run();
}

/** Throw on a failed query instead of carrying on with half the data written. */
function check<T extends { error: { message: string } | null }>(result: T, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result;
}

const chunk = <T>(rows: T[], size = 200) => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

/**
 * Control tick.
 *
 * 1. Advances the world: arrivals (demand-driven) minus discharge achieved by
 *    the green time that was actually running, so the observed queue responds
 *    to the previous signal decision.
 * 2. Re-estimates arrival rates, solves each junction with Webster's method
 *    and writes the resulting plan, predicted delays and predicted queues.
 * 3. Scores the previous prediction against the new observation.
 *
 * It never changes who holds the green: that belongs to advanceSignals().
 */
export async function performTick() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const gate = check(
    await supabaseAdmin.rpc("try_acquire_control", {
      p_name: "tick",
      p_min_interval_ms: MIN_TICK_GAP_MS,
    }),
    "Control throttle unavailable (is the latest migration applied?)",
  );
  if (!gate.data) return { ok: true, cycles: 0, skipped: true };

  const now = new Date();
  const nowMs = now.getTime();
  const factor = timeOfDayFactor(now);

  const roadsResult = check(
    await supabaseAdmin
      .from("roads")
      .select("road_id, junction_id, direction, max_capacity")
      .order("road_id"),
    "roads",
  );
  const roadRows = (roadsResult.data ?? []) as RoadRow[];
  if (roadRows.length === 0) return { ok: true, cycles: 0 };

  const [counts, models, timings, cycles, incidents] = await Promise.all([
    supabaseAdmin.from("v_latest_vehicle_count").select("road_id, vehicle_count"),
    supabaseAdmin
      .from("model_road_state")
      .select(
        "road_id, arrival_rate_vph, green_sec, cycle_length_sec, queue_now, queue_exact, predicted_queue_next, updated_at",
      ),
    supabaseAdmin
      .from("signal_timings")
      .select(
        "timing_id, road_id, junction_id, green_duration_sec, is_currently_green, updated_at",
      ),
    supabaseAdmin.from("v_junction_cycle").select("junction_id, cycle_number"),
    supabaseAdmin
      .from("incidents")
      .select("road_id")
      .lte("starts_at", now.toISOString())
      .gt("ends_at", now.toISOString()),
  ]);
  check(counts, "latest vehicle counts");
  check(models, "model state");
  check(timings, "signal timings");
  check(cycles, "cycle numbers");
  check(incidents, "incidents");

  const previousQueue = new Map<number, number>(
    ((counts.data ?? []) as Array<{ road_id: number; vehicle_count: number }>).map((row) => [
      row.road_id,
      row.vehicle_count,
    ]),
  );
  const stateByRoad = new Map<number, ModelStateRow>(
    ((models.data ?? []) as ModelStateRow[]).map((row) => [row.road_id, row]),
  );
  const timingByRoad = new Map<number, TimingRow>(
    ((timings.data ?? []) as TimingRow[]).map((row) => [row.road_id, row]),
  );
  const cycleByJunction = new Map<number, number>(
    ((cycles.data ?? []) as Array<{ junction_id: number; cycle_number: number | null }>).map(
      (row) => [row.junction_id, Number(row.cycle_number ?? 0)],
    ),
  );
  // A blocked lane keeps only part of its capacity while the incident lasts.
  const blockedRoads = new Set<number>(
    ((incidents.data ?? []) as Array<{ road_id: number }>).map((row) => row.road_id),
  );
  const capacityFactorOf = (roadId: number) =>
    blockedRoads.has(roadId) ? INCIDENT_CAPACITY_FACTOR : 1;

  // ---- 1. Advance the physical queues -------------------------------------
  const queues = new Map<number, number>();
  const exactQueues = new Map<number, number>();
  const elapsedByRoad = new Map<number, number>();
  const greenSecondsByRoad = new Map<number, number>();
  const measuredArrivals = new Map<number, number>();
  const sensorRows: Array<{ road_id: number; vehicle_count: number; source: string }> = [];

  for (const road of roadRows) {
    const state = stateByRoad.get(road.road_id);
    const elapsed = state
      ? clamp((nowMs - new Date(state.updated_at).getTime()) / 1000, 4, 120)
      : NOMINAL_TICK_SEC;
    elapsedByRoad.set(road.road_id, elapsed);

    // Discharge only happens while this approach holds the green, and not during the
    // start-up lost time at the beginning of a phase. This sees the phase that is
    // running now; a phase that began and ended inside the window is not visible here.
    const timing = timingByRoad.get(road.road_id);
    const greenSeconds = timing?.is_currently_green
      ? effectiveGreenSeconds(new Date(timing.updated_at).getTime(), nowMs - elapsed * 1000, nowMs)
      : 0;
    greenSecondsByRoad.set(road.road_id, greenSeconds);

    // Demand is expressed against this approach's own capacity, so off-peak
    // clears and peak genuinely oversaturates the junction.
    const step = stepQueue({
      roadId: road.road_id,
      maxCapacity: road.max_capacity,
      factor,
      elapsedSec: elapsed,
      // With no model state yet, seed the queue from the last reading (or 0).
      priorExact: state ? Number(state.queue_exact) : (previousQueue.get(road.road_id) ?? 0),
      greenSeconds,
      capacityFactor: capacityFactorOf(road.road_id),
    });
    measuredArrivals.set(road.road_id, step.measuredArrivals);
    exactQueues.set(road.road_id, Number(step.exact.toFixed(2)));
    queues.set(road.road_id, step.queue);
    sensorRows.push({
      road_id: road.road_id,
      vehicle_count: step.queue,
      source: "SIMULATED_SENSOR",
    });
  }

  check(await supabaseAdmin.from("vehicle_counts").insert(sensorRows), "vehicle_counts insert");

  // ---- 2. Score the previous prediction -----------------------------------
  // abs_error is a generated column: the database works it out from the two queues.
  const accuracyRows: Array<{
    road_id: number;
    junction_id: number;
    predicted_queue: number;
    actual_queue: number;
    baseline_queue: number;
  }> = [];
  for (const road of roadRows) {
    const state = stateByRoad.get(road.road_id);
    if (!state) continue;
    accuracyRows.push({
      road_id: road.road_id,
      junction_id: road.junction_id,
      predicted_queue: state.predicted_queue_next,
      actual_queue: queues.get(road.road_id) ?? 0,
      // What "nothing changes" would have predicted, to compare the model against.
      baseline_queue: state.queue_now,
    });
  }

  // ---- 3. Solve every junction --------------------------------------------
  const byJunction = new Map<number, RoadRow[]>();
  for (const road of roadRows) {
    const list = byJunction.get(road.junction_id) ?? [];
    list.push(road);
    byJunction.set(road.junction_id, list);
  }

  type HistoryRow = {
    junction_id: number;
    road_id: number;
    vehicle_count_at_decision: number;
    allocated_green_sec: number;
    baseline_fixed_sec: number;
    estimated_wait_saved_sec: number;
    cycle_number: number;
    arrival_rate_vph: number;
    saturation_flow_vph: number;
    degree_saturation: number;
    predicted_delay_adaptive_sec: number;
    predicted_delay_fixed_sec: number;
    predicted_queue_next: number;
    cycle_length_sec: number;
  };
  type ModelStateInsert = {
    road_id: number;
    junction_id: number;
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
    updated_at: string;
  };
  const historyRows: HistoryRow[] = [];
  const modelStateRows: ModelStateInsert[] = [];
  const allocations: Array<{ road_id: number; green: number }> = [];

  for (const [junctionId, junctionRoads] of byJunction) {
    const elapsed =
      junctionRoads.reduce(
        (sum, r) => sum + (elapsedByRoad.get(r.road_id) ?? NOMINAL_TICK_SEC),
        0,
      ) / junctionRoads.length;

    const inputs: ApproachInput[] = junctionRoads.map((road) => {
      const state = stateByRoad.get(road.road_id);
      return {
        roadId: road.road_id,
        queue: queues.get(road.road_id) ?? 0,
        previousQueue: state
          ? Math.round(Number(state.queue_exact))
          : (previousQueue.get(road.road_id) ?? null),
        // Green seconds this approach actually received inside the window.
        previousGreen: greenSecondsByRoad.get(road.road_id) ?? 0,
        previousArrivalRate: state ? Number(state.arrival_rate_vph) : null,
        measuredArrivals: measuredArrivals.get(road.road_id) ?? null,
        maxCapacity: road.max_capacity,
        capacityFactor: capacityFactorOf(road.road_id),
      };
    });

    const fixedPlan = fixedPlanForJunction(junctionId);
    const solution = solveJunction(inputs, elapsed, fixedPlan);
    const cycle = (cycleByJunction.get(junctionId) ?? 0) + 1;

    solution.approaches.forEach((approach, index) => {
      allocations.push({ road_id: approach.roadId, green: approach.green });

      // Queue expected at the next control update (used to score the model): the approach
      // is green for green/cycle of the time, whichever phase the controller picks next.
      const dischargeNext =
        (approach.saturationFlowVph / 3600) * elapsed * (approach.green / solution.cycleLength);
      const predictedNextReading = Math.max(
        0,
        Math.round(approach.queue + (approach.arrivalRateVph / 3600) * elapsed - dischargeNext),
      );

      modelStateRows.push({
        road_id: approach.roadId,
        junction_id: junctionId,
        arrival_rate_vph: approach.arrivalRateVph,
        saturation_flow_vph: approach.saturationFlowVph,
        flow_ratio: approach.flowRatio,
        degree_saturation: approach.degreeSaturation,
        green_sec: approach.green,
        cycle_length_sec: solution.cycleLength,
        queue_now: approach.queue,
        queue_exact: exactQueues.get(approach.roadId) ?? approach.queue,
        predicted_queue_next: predictedNextReading,
        predicted_delay_adaptive_sec: approach.delayAdaptive,
        predicted_delay_fixed_sec: approach.delayFixed,
        queue_clears: approach.queueClears,
        updated_at: now.toISOString(),
      });

      historyRows.push({
        junction_id: junctionId,
        road_id: approach.roadId,
        vehicle_count_at_decision: approach.queue,
        allocated_green_sec: approach.green,
        baseline_fixed_sec: fixedPlan?.greens[index] ?? FIXED_GREEN,
        // Signed: negative where the adaptive plan is predicted to do worse than the timer.
        estimated_wait_saved_sec: Math.round(approach.savedVehicleSeconds),
        cycle_number: cycle,
        arrival_rate_vph: approach.arrivalRateVph,
        saturation_flow_vph: approach.saturationFlowVph,
        degree_saturation: approach.degreeSaturation,
        predicted_delay_adaptive_sec: approach.delayAdaptive,
        predicted_delay_fixed_sec: approach.delayFixed,
        predicted_queue_next: approach.predictedQueueNext,
        cycle_length_sec: solution.cycleLength,
      });
    });
  }

  // ---- 4. Persist -----------------------------------------------------------
  // The plan is written without touching who holds the green or since when.
  check(
    await supabaseAdmin.rpc("apply_green_allocations", { p: allocations }),
    "green allocations",
  );
  for (const batch of chunk(modelStateRows)) {
    check(
      await supabaseAdmin.from("model_road_state").upsert(batch, { onConflict: "road_id" }),
      "model state",
    );
  }
  for (const batch of chunk(historyRows, 400)) {
    check(await supabaseAdmin.from("signal_history").insert(batch), "signal history");
  }
  for (const batch of chunk(accuracyRows, 400)) {
    check(await supabaseAdmin.from("model_accuracy").insert(batch), "model accuracy");
  }

  // ---- 5. CCTV as a second, noisier measurement of the same queue ---------
  const cctvRoads = roadRows.filter(() => Math.random() < 0.25).slice(0, 24);
  if (cctvRoads.length > 0) {
    const cameras = check(
      await supabaseAdmin
        .from("cctv_cameras")
        .select("camera_id, road_id")
        .in(
          "road_id",
          cctvRoads.map((r) => r.road_id),
        ),
      "cameras",
    );
    const lastFrames = check(
      await supabaseAdmin
        .from("cctv_analysis_log")
        .select("camera_id, frame_number")
        .order("analysis_id", { ascending: false })
        .limit(200),
      "camera frames",
    );
    const frameByCamera = new Map<number, number>();
    for (const row of (lastFrames.data ?? []) as Array<{
      camera_id: number;
      frame_number: number;
    }>) {
      if (!frameByCamera.has(row.camera_id))
        frameByCamera.set(row.camera_id, row.frame_number ?? 0);
    }

    const analysisRows: Array<{
      camera_id: number;
      frame_number: number;
      vehicles_detected: number;
      confidence_avg: number;
    }> = [];
    for (const camera of (cameras.data ?? []) as Array<{ camera_id: number; road_id: number }>) {
      const queue = queues.get(camera.road_id) ?? 20;
      const detected = clamp(Math.round(queue * (0.88 + Math.random() * 0.24)), 0, 200);
      analysisRows.push({
        camera_id: camera.camera_id,
        frame_number: (frameByCamera.get(camera.camera_id) ?? 0) + 1,
        vehicles_detected: detected,
        confidence_avg: Number((0.82 + Math.random() * 0.16).toFixed(3)),
      });
    }
    if (analysisRows.length > 0) {
      check(await supabaseAdmin.from("cctv_analysis_log").insert(analysisRows), "camera analysis");
    }
  }

  // Keep the rolling window small so the city-wide network stays fast. The database owns
  // the retention rules; here we only ask it to apply them, and not on every tick.
  const prune = await supabaseAdmin.rpc("try_acquire_control", {
    p_name: "prune",
    p_min_interval_ms: MIN_PRUNE_GAP_MS,
  });
  if (!prune.error && prune.data) {
    check(await supabaseAdmin.rpc("prune_old_rows"), "retention");
  }

  return { ok: true, cycles: byJunction.size, at: now.toISOString() };
}

export const runTrafficTick = createServerFn({ method: "POST" }).handler(async () =>
  browserGuard(performTick),
);

// ===========================================================================
// Real-time phase controller
// ===========================================================================

type PhaseModel = {
  road_id: number;
  junction_id: number;
  green_sec: number;
  degree_saturation: number;
  queue_now: number;
};

/**
 * Runs the signals in real time: every call checks each junction's running
 * phase against the green time the model currently allocates it, ends the
 * phase when its green has been served (or when another approach is under
 * clearly worse pressure, or has waited too long), and hands the green to the
 * best-placed approach. Called far more often than the model tick, so green
 * times respond to congestion as it changes rather than once per cycle.
 *
 * All the changes go to the database in one call that applies them junction by
 * junction, so a half-applied handover cannot leave two approaches green.
 */
export async function performAdvance() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const gate = check(
    await supabaseAdmin.rpc("try_acquire_control", {
      p_name: "advance",
      p_min_interval_ms: MIN_ADVANCE_GAP_MS,
    }),
    "Control throttle unavailable (is the latest migration applied?)",
  );
  if (!gate.data) return { ok: true, switched: 0, skipped: true };

  const [timingResult, modelResult] = await Promise.all([
    supabaseAdmin
      .from("signal_timings")
      .select(
        "timing_id, road_id, junction_id, green_duration_sec, is_currently_green, updated_at",
      ),
    supabaseAdmin
      .from("model_road_state")
      .select("road_id, junction_id, green_sec, degree_saturation, queue_now"),
  ]);
  check(timingResult, "signal timings");
  check(modelResult, "model state");

  const timings = (timingResult.data ?? []) as TimingRow[];
  if (timings.length === 0) return { ok: true, switched: 0 };

  const modelByRoad = new Map<number, PhaseModel>(
    ((modelResult.data ?? []) as PhaseModel[]).map((row) => [row.road_id, row]),
  );

  const byJunction = new Map<number, TimingRow[]>();
  for (const row of timings) {
    const list = byJunction.get(row.junction_id);
    if (list) list.push(row);
    else byJunction.set(row.junction_id, [row]);
  }

  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const changes: Array<{ end_road: number | null; start_road: number; green: number }> = [];

  for (const [, approaches] of byJunction) {
    const phaseApproaches: PhaseApproach[] = approaches.map((row) => {
      const model = modelByRoad.get(row.road_id);
      return {
        roadId: row.road_id,
        isGreen: row.is_currently_green,
        // updated_at only moves when the approach changes colour, so this is when it turned
        // green or red, which is what the waiting-time rule needs.
        startedAtMs: new Date(row.updated_at).getTime(),
        allocatedGreen: Number(model?.green_sec ?? row.green_duration_sec),
        pressure: approachPressure(
          model
            ? {
                degreeSaturation: Number(model.degree_saturation),
                queueNow: Number(model.queue_now),
              }
            : null,
        ),
      };
    });

    const decision = decidePhase(phaseApproaches, now);
    if (!decision) continue;
    changes.push({
      end_road: decision.endRoadId,
      start_road: decision.startRoadId,
      green: decision.startGreen,
    });
  }

  if (changes.length === 0) return { ok: true, switched: 0, at: stamp };

  const applied = check(
    await supabaseAdmin.rpc("apply_phase_changes", { p: changes }),
    "phase changes",
  );
  return { ok: true, switched: Number(applied.data ?? 0), at: stamp };
}

export const advanceSignals = createServerFn({ method: "POST" }).handler(async () =>
  browserGuard(performAdvance),
);
