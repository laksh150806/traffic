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
  /** Modelled average wait per vehicle under the junction's fixed-time reference plan (s). */
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
  /** Mean absolute error of simply assuming the queue stays as it is, for comparison. */
  baselineMeanAbsError: number;
  /** Junctions where the adaptive plan is predicted to wait longer than the fixed timer. */
  junctionsAdaptiveWorse: number;
  junctionsTotal: number;
};

/** Modelled (not measured) vehicle-seconds of waiting avoided, over the stated window. */
export type ModelledSaving = {
  seconds: number;
  windowMin: number;
};

export type CctvPoint = {
  frame_number: number;
  vehicles_detected: number;
  confidence_avg: number;
  camera_name: string;
  analyzed_at: string;
};

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
