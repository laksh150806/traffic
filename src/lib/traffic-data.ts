import { supabase } from "@/integrations/supabase/client";
import { DATA_MODE } from "@/lib/data-mode";
import * as demo from "@/lib/demo-engine";
import {
  aggregateCycleRows,
  computeModelPerformance,
  directionRank,
  type CycleRow,
  type ModelStateSlice,
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

export type {
  ApproachModelState,
  CameraTile,
  CctvPoint,
  CongestionLevel,
  CyclePoint,
  JunctionSummary,
  ModelPerformance,
  RoadState,
} from "@/lib/traffic-types";

const isDemo = DATA_MODE === "demo";

export async function fetchJunctions(): Promise<JunctionSummary[]> {
  if (isDemo) return demo.demoFetchJunctions();
  const { data, error } = await supabase
    .from("v_junction_congestion")
    .select("*")
    .order("junction_id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    junction_id: Number(row["junction_id"]),
    name: String(row["name"]),
    zone: String(row["zone"] ?? "Central"),
    latitude: Number(row["latitude"]),
    longitude: Number(row["longitude"]),
    avg_vehicle_count: Number(row["avg_vehicle_count"] ?? 0),
    total_vehicle_count: Number(row["total_vehicle_count"] ?? 0),
    congestion_level: (row["congestion_level"] as CongestionLevel) ?? "LOW",
    last_reading_at: (row["last_reading_at"] as string | null) ?? null,
  }));
}

export async function fetchRoadStates(junctionId: number): Promise<RoadState[]> {
  if (isDemo) return demo.demoFetchRoadStates(junctionId);
  const { data: roads, error } = await supabase
    .from("roads")
    .select("road_id, direction, road_name, max_capacity")
    .eq("junction_id", junctionId);
  if (error) throw new Error(error.message);
  const roadRows = (roads ?? []) as Array<{
    road_id: number;
    direction: string;
    road_name: string | null;
    max_capacity: number;
  }>;
  const roadIds = roadRows.map((r) => r.road_id);
  if (roadIds.length === 0) return [];

  const [{ data: timings }, { data: counts }] = await Promise.all([
    supabase
      .from("signal_timings")
      .select("road_id, green_duration_sec, timing_mode, is_currently_green, updated_at")
      .in("road_id", roadIds),
    supabase
      .from("vehicle_counts")
      .select("road_id, vehicle_count, source, recorded_at")
      .in("road_id", roadIds)
      .order("recorded_at", { ascending: false })
      .limit(120),
  ]);

  const timingByRoad = new Map(
    ((timings ?? []) as Array<Record<string, unknown>>).map((t) => [Number(t["road_id"]), t]),
  );
  const latestByRoad = new Map<number, Record<string, unknown>>();
  for (const row of (counts ?? []) as Array<Record<string, unknown>>) {
    const id = Number(row["road_id"]);
    if (!latestByRoad.has(id)) latestByRoad.set(id, row);
  }

  return roadRows
    .map((road) => {
      const timing = timingByRoad.get(road.road_id);
      const latest = latestByRoad.get(road.road_id);
      return {
        road_id: road.road_id,
        direction: road.direction,
        road_name: road.road_name,
        max_capacity: road.max_capacity,
        vehicle_count: Number(latest?.["vehicle_count"] ?? 0),
        source: String(latest?.["source"] ?? "SIMULATED_SENSOR"),
        recorded_at: (latest?.["recorded_at"] as string | undefined) ?? null,
        green_duration_sec: Number(timing?.["green_duration_sec"] ?? 30),
        timing_mode: String(timing?.["timing_mode"] ?? "ADAPTIVE"),
        is_currently_green: Boolean(timing?.["is_currently_green"] ?? false),
        phase_started_at: (timing?.["updated_at"] as string | undefined) ?? null,
      };
    })
    .sort((a, b) => directionRank(a.direction) - directionRank(b.direction));
}

export async function fetchCycleComparison(junctionId: number): Promise<CyclePoint[]> {
  if (isDemo) return demo.demoFetchCycleComparison(junctionId);
  const { data, error } = await supabase
    .from("signal_history")
    .select(
      "cycle_number, allocated_green_sec, baseline_fixed_sec, estimated_wait_saved_sec, predicted_delay_adaptive_sec, predicted_delay_fixed_sec",
    )
    .eq("junction_id", junctionId)
    .order("history_id", { ascending: false })
    .limit(120);
  if (error) throw new Error(error.message);

  return aggregateCycleRows((data ?? []) as CycleRow[]);
}

export async function fetchJunctionModel(junctionId: number): Promise<ApproachModelState[]> {
  if (isDemo) return demo.demoFetchJunctionModel(junctionId);
  const [{ data: roads }, { data: state, error }] = await Promise.all([
    supabase.from("roads").select("road_id, direction").eq("junction_id", junctionId),
    supabase.from("model_road_state").select("*").eq("junction_id", junctionId),
  ]);
  if (error) throw new Error(error.message);
  const dirByRoad = new Map(
    ((roads ?? []) as Array<{ road_id: number; direction: string }>).map((r) => [
      r.road_id,
      r.direction,
    ]),
  );

  return ((state ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      road_id: Number(row["road_id"]),
      direction: dirByRoad.get(Number(row["road_id"])) ?? "—",
      arrival_rate_vph: Number(row["arrival_rate_vph"] ?? 0),
      saturation_flow_vph: Number(row["saturation_flow_vph"] ?? 0),
      degree_saturation: Number(row["degree_saturation"] ?? 0),
      green_sec: Number(row["green_sec"] ?? 0),
      cycle_length_sec: Number(row["cycle_length_sec"] ?? 0),
      queue_now: Number(row["queue_now"] ?? 0),
      predicted_queue_next: Number(row["predicted_queue_next"] ?? 0),
      predicted_delay_adaptive_sec: Number(row["predicted_delay_adaptive_sec"] ?? 0),
      predicted_delay_fixed_sec: Number(row["predicted_delay_fixed_sec"] ?? 0),
      queue_clears: Boolean(row["queue_clears"]),
    }))
    .sort((a, b) => directionRank(a.direction) - directionRank(b.direction));
}

export async function fetchModelPerformance(): Promise<ModelPerformance> {
  if (isDemo) return demo.demoFetchModelPerformance();
  const [{ data: accuracy }, { data: state }] = await Promise.all([
    supabase
      .from("model_accuracy")
      .select("abs_error")
      .order("recorded_at", { ascending: false })
      .limit(1500),
    supabase
      .from("model_road_state")
      .select(
        "arrival_rate_vph, degree_saturation, predicted_delay_adaptive_sec, predicted_delay_fixed_sec",
      ),
  ]);

  const errors = ((accuracy ?? []) as Array<{ abs_error: number }>).map((r) =>
    Number(r.abs_error ?? 0),
  );
  return computeModelPerformance(errors, (state ?? []) as ModelStateSlice[]);
}

export async function fetchTotalSecondsSaved(): Promise<number> {
  if (isDemo) return demo.demoFetchTotalSecondsSaved();
  const { data, error } = await supabase
    .from("signal_history")
    .select("estimated_wait_saved_sec")
    .order("history_id", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ estimated_wait_saved_sec: number }>).reduce(
    (sum, row) => sum + Number(row.estimated_wait_saved_sec ?? 0),
    0,
  );
}

export async function fetchCctvFeed(junctionId: number): Promise<CctvPoint[]> {
  if (isDemo) return demo.demoFetchCctvFeed(junctionId);
  const { data: roads } = await supabase
    .from("roads")
    .select("road_id")
    .eq("junction_id", junctionId);
  const roadIds = ((roads ?? []) as Array<{ road_id: number }>).map((r) => r.road_id);
  if (roadIds.length === 0) return [];

  const { data: cameras } = await supabase
    .from("cctv_cameras")
    .select("camera_id, camera_name")
    .in("road_id", roadIds);
  const cameraRows = (cameras ?? []) as Array<{ camera_id: number; camera_name: string | null }>;
  if (cameraRows.length === 0) return [];
  const nameById = new Map(
    cameraRows.map((c) => [c.camera_id, c.camera_name ?? `CAM-${c.camera_id}`]),
  );

  const { data, error } = await supabase
    .from("cctv_analysis_log")
    .select("camera_id, frame_number, vehicles_detected, confidence_avg, analyzed_at")
    .in(
      "camera_id",
      cameraRows.map((c) => c.camera_id),
    )
    .order("analysis_id", { ascending: false })
    .limit(24);
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      frame_number: Number(row["frame_number"] ?? 0),
      vehicles_detected: Number(row["vehicles_detected"] ?? 0),
      confidence_avg: Number(row["confidence_avg"] ?? 0),
      camera_name: nameById.get(Number(row["camera_id"])) ?? "CAM",
      analyzed_at: String(row["analyzed_at"]),
    }))
    .reverse();
}

/**
 * One row per camera at a junction: which approach it watches plus its latest
 * analysed frame, used to render the camera wall.
 */
export async function fetchCameraTiles(junctionId: number): Promise<CameraTile[]> {
  if (isDemo) return demo.demoFetchCameraTiles(junctionId);
  const { data: roads } = await supabase
    .from("roads")
    .select("road_id, direction, road_name")
    .eq("junction_id", junctionId);
  const roadRows = (roads ?? []) as Array<{
    road_id: number;
    direction: string;
    road_name: string | null;
  }>;
  if (roadRows.length === 0) return [];
  const roadById = new Map(roadRows.map((r) => [r.road_id, r]));

  const { data: cameras } = await supabase
    .from("cctv_cameras")
    .select("camera_id, camera_name, status, road_id")
    .in(
      "road_id",
      roadRows.map((r) => r.road_id),
    );
  const cameraRows = (cameras ?? []) as Array<{
    camera_id: number;
    camera_name: string | null;
    status: string;
    road_id: number;
  }>;
  if (cameraRows.length === 0) return [];

  const { data: logs } = await supabase
    .from("cctv_analysis_log")
    .select("camera_id, frame_number, confidence_avg, analyzed_at")
    .in(
      "camera_id",
      cameraRows.map((c) => c.camera_id),
    )
    .order("analysis_id", { ascending: false })
    .limit(80);

  const latestByCamera = new Map<number, Record<string, unknown>>();
  for (const row of (logs ?? []) as Array<Record<string, unknown>>) {
    const id = Number(row["camera_id"]);
    if (!latestByCamera.has(id)) latestByCamera.set(id, row);
  }

  return cameraRows
    .map((camera) => {
      const road = roadById.get(camera.road_id);
      const latest = latestByCamera.get(camera.camera_id);
      return {
        camera_id: camera.camera_id,
        camera_name: camera.camera_name ?? `CAM-${camera.camera_id}`,
        status: camera.status ?? "ONLINE",
        road_id: camera.road_id,
        direction: road?.direction ?? "NORTH",
        road_name: road?.road_name ?? null,
        frame_number: Number(latest?.["frame_number"] ?? 0),
        confidence_avg: Number(latest?.["confidence_avg"] ?? 0.9),
        analyzed_at: (latest?.["analyzed_at"] as string | undefined) ?? null,
      };
    })
    .sort((a, b) => directionRank(a.direction) - directionRank(b.direction));
}
