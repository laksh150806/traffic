import { supabase } from "@/integrations/supabase/client";

export type CongestionLevel = "LOW" | "MODERATE" | "HIGH";

export type JunctionSummary = {
  junction_id: number;
  name: string;
  zone: string;
  latitude: number;
  longitude: number;
  avg_vehicle_count: number;
  total_vehicle_count: number;
  congestion_level: CongestionLevel;
  last_reading_at: string | null;
};

export type RoadState = {
  road_id: number;
  direction: string;
  road_name: string | null;
  max_capacity: number;
  vehicle_count: number;
  source: string;
  recorded_at: string | null;
  green_duration_sec: number;
  timing_mode: string;
  is_currently_green: boolean;
  /** When the current phase state started, used for the live green countdown. */
  phase_started_at: string | null;
};

export type CyclePoint = {
  cycle_number: number;
  adaptive_sec: number;
  fixed_sec: number;
  saved_sec: number;
  /** Modelled average wait per vehicle under the adaptive plan (s). */
  delay_adaptive: number;
  /** Modelled average wait per vehicle under a fixed 30s/120s plan (s). */
  delay_fixed: number;
};

export type ApproachModelState = {
  road_id: number;
  direction: string;
  arrival_rate_vph: number;
  saturation_flow_vph: number;
  degree_saturation: number;
  green_sec: number;
  cycle_length_sec: number;
  queue_now: number;
  predicted_queue_next: number;
  predicted_delay_adaptive_sec: number;
  predicted_delay_fixed_sec: number;
  queue_clears: boolean;
};

export type ModelPerformance = {
  /** Mean absolute error of the queue prediction, vehicles. */
  meanAbsError: number;
  /** Share of predictions within 3 vehicles of reality. */
  hitRate: number;
  samples: number;
  /** Flow-weighted average wait per vehicle across the whole network. */
  networkDelayAdaptive: number;
  networkDelayFixed: number;
  /** Approaches predicted to be over capacity (x > 1). */
  saturatedApproaches: number;
};


export type CctvPoint = {
  frame_number: number;
  vehicles_detected: number;
  confidence_avg: number;
  camera_name: string;
  analyzed_at: string;
};

const DIRECTION_ORDER = ["NORTH", "EAST", "SOUTH", "WEST"];

export async function fetchJunctions(): Promise<JunctionSummary[]> {
  const { data, error } = await supabase
    .from("v_junction_congestion")
    .select("*")
    .order("junction_id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    junction_id: Number(row['junction_id']),
    name: String(row['name']),
    zone: String(row['zone'] ?? "Central"),
    latitude: Number(row['latitude']),
    longitude: Number(row['longitude']),
    avg_vehicle_count: Number(row['avg_vehicle_count'] ?? 0),
    total_vehicle_count: Number(row['total_vehicle_count'] ?? 0),
    congestion_level: (row['congestion_level'] as CongestionLevel) ?? "LOW",
    last_reading_at: (row['last_reading_at'] as string | null) ?? null,
  }));
}

export async function fetchRoadStates(junctionId: number): Promise<RoadState[]> {
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
    ((timings ?? []) as Array<Record<string, unknown>>).map((t) => [Number(t['road_id']), t]),
  );
  const latestByRoad = new Map<number, Record<string, unknown>>();
  for (const row of (counts ?? []) as Array<Record<string, unknown>>) {
    const id = Number(row['road_id']);
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
        vehicle_count: Number(latest?.['vehicle_count'] ?? 0),
        source: String(latest?.['source'] ?? "SIMULATED_SENSOR"),
        recorded_at: (latest?.['recorded_at'] as string | undefined) ?? null,
        green_duration_sec: Number(timing?.['green_duration_sec'] ?? 30),
        timing_mode: String(timing?.['timing_mode'] ?? "ADAPTIVE"),
        is_currently_green: Boolean(timing?.['is_currently_green'] ?? false),
        phase_started_at: (timing?.['updated_at'] as string | undefined) ?? null,
      };
    })
    .sort((a, b) => DIRECTION_ORDER.indexOf(a.direction) - DIRECTION_ORDER.indexOf(b.direction));
}

export async function fetchCycleComparison(junctionId: number): Promise<CyclePoint[]> {
  const { data, error } = await supabase
    .from("signal_history")
    .select(
      "cycle_number, allocated_green_sec, baseline_fixed_sec, estimated_wait_saved_sec, predicted_delay_adaptive_sec, predicted_delay_fixed_sec",
    )
    .eq("junction_id", junctionId)
    .order("history_id", { ascending: false })
    .limit(120);
  if (error) throw new Error(error.message);

  const byCycle = new Map<number, CyclePoint & { n: number }>();
  for (const row of (data ?? []) as Array<Record<string, number>>) {
    const cycle = Number(row['cycle_number'] ?? 0);
    const point = byCycle.get(cycle) ?? {
      cycle_number: cycle,
      adaptive_sec: 0,
      fixed_sec: 0,
      saved_sec: 0,
      delay_adaptive: 0,
      delay_fixed: 0,
      n: 0,
    };
    point.adaptive_sec += Number(row['allocated_green_sec'] ?? 0);
    point.fixed_sec += Number(row['baseline_fixed_sec'] ?? 30);
    point.saved_sec += Number(row['estimated_wait_saved_sec'] ?? 0);
    point.delay_adaptive += Number(row['predicted_delay_adaptive_sec'] ?? 0);
    point.delay_fixed += Number(row['predicted_delay_fixed_sec'] ?? 0);
    point.n += 1;
    byCycle.set(cycle, point);
  }

  return Array.from(byCycle.values())
    .sort((a, b) => a.cycle_number - b.cycle_number)
    .slice(-15)
    .map(({ n, ...point }) => ({
      ...point,
      delay_adaptive: Number((point.delay_adaptive / Math.max(n, 1)).toFixed(1)),
      delay_fixed: Number((point.delay_fixed / Math.max(n, 1)).toFixed(1)),
    }));
}

export async function fetchJunctionModel(junctionId: number): Promise<ApproachModelState[]> {
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
      road_id: Number(row['road_id']),
      direction: dirByRoad.get(Number(row['road_id'])) ?? "—",
      arrival_rate_vph: Number(row['arrival_rate_vph'] ?? 0),
      saturation_flow_vph: Number(row['saturation_flow_vph'] ?? 0),
      degree_saturation: Number(row['degree_saturation'] ?? 0),
      green_sec: Number(row['green_sec'] ?? 0),
      cycle_length_sec: Number(row['cycle_length_sec'] ?? 0),
      queue_now: Number(row['queue_now'] ?? 0),
      predicted_queue_next: Number(row['predicted_queue_next'] ?? 0),
      predicted_delay_adaptive_sec: Number(row['predicted_delay_adaptive_sec'] ?? 0),
      predicted_delay_fixed_sec: Number(row['predicted_delay_fixed_sec'] ?? 0),
      queue_clears: Boolean(row['queue_clears']),
    }))
    .sort((a, b) => DIRECTION_ORDER.indexOf(a.direction) - DIRECTION_ORDER.indexOf(b.direction));
}

export async function fetchModelPerformance(): Promise<ModelPerformance> {
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
  const samples = errors.length;
  const meanAbsError = samples > 0 ? errors.reduce((a, b) => a + b, 0) / samples : 0;
  const hitRate = samples > 0 ? errors.filter((e) => e <= 3).length / samples : 0;

  const rows = (state ?? []) as Array<Record<string, number>>;
  let flow = 0;
  let adaptive = 0;
  let fixed = 0;
  let saturated = 0;
  for (const row of rows) {
    const w = Number(row['arrival_rate_vph'] ?? 0);
    flow += w;
    adaptive += Number(row['predicted_delay_adaptive_sec'] ?? 0) * w;
    fixed += Number(row['predicted_delay_fixed_sec'] ?? 0) * w;
    if (Number(row['degree_saturation'] ?? 0) > 1) saturated += 1;
  }

  return {
    meanAbsError: Number(meanAbsError.toFixed(2)),
    hitRate: Number(hitRate.toFixed(3)),
    samples,
    networkDelayAdaptive: Number((flow > 0 ? adaptive / flow : 0).toFixed(1)),
    networkDelayFixed: Number((flow > 0 ? fixed / flow : 0).toFixed(1)),
    saturatedApproaches: saturated,
  };
}


export async function fetchTotalSecondsSaved(): Promise<number> {
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
  const { data: roads } = await supabase.from("roads").select("road_id").eq("junction_id", junctionId);
  const roadIds = ((roads ?? []) as Array<{ road_id: number }>).map((r) => r.road_id);
  if (roadIds.length === 0) return [];

  const { data: cameras } = await supabase
    .from("cctv_cameras")
    .select("camera_id, camera_name")
    .in("road_id", roadIds);
  const cameraRows = (cameras ?? []) as Array<{ camera_id: number; camera_name: string | null }>;
  if (cameraRows.length === 0) return [];
  const nameById = new Map(cameraRows.map((c) => [c.camera_id, c.camera_name ?? `CAM-${c.camera_id}`]));

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
      frame_number: Number(row['frame_number'] ?? 0),
      vehicles_detected: Number(row['vehicles_detected'] ?? 0),
      confidence_avg: Number(row['confidence_avg'] ?? 0),
      camera_name: nameById.get(Number(row['camera_id'])) ?? "CAM",
      analyzed_at: String(row['analyzed_at']),
    }))
    .reverse();
}

export type CameraTile = {
  camera_id: number;
  camera_name: string;
  status: string;
  road_id: number;
  direction: string;
  road_name: string | null;
  frame_number: number;
  confidence_avg: number;
  analyzed_at: string | null;
};

/**
 * One row per camera at a junction: which approach it watches plus its latest
 * analysed frame, used to render the camera wall.
 */
export async function fetchCameraTiles(junctionId: number): Promise<CameraTile[]> {
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
    const id = Number(row['camera_id']);
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
        frame_number: Number(latest?.['frame_number'] ?? 0),
        confidence_avg: Number(latest?.['confidence_avg'] ?? 0.9),
        analyzed_at: (latest?.['analyzed_at'] as string | undefined) ?? null,
      };
    })
    .sort(
      (a, b) => DIRECTION_ORDER.indexOf(a.direction) - DIRECTION_ORDER.indexOf(b.direction),
    );
}
