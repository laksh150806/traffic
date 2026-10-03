
CREATE TABLE public.junctions (
  junction_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.junctions TO anon, authenticated;
GRANT ALL ON public.junctions TO service_role;
ALTER TABLE public.junctions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "junctions_public_read" ON public.junctions FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.roads (
  road_id SERIAL PRIMARY KEY,
  junction_id INT NOT NULL REFERENCES public.junctions(junction_id) ON DELETE CASCADE,
  direction VARCHAR(10) NOT NULL,
  road_name VARCHAR(100),
  max_capacity INT NOT NULL DEFAULT 100,
  UNIQUE (junction_id, direction)
);
GRANT SELECT ON public.roads TO anon, authenticated;
GRANT ALL ON public.roads TO service_role;
ALTER TABLE public.roads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roads_public_read" ON public.roads FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.cctv_cameras (
  camera_id SERIAL PRIMARY KEY,
  road_id INT NOT NULL REFERENCES public.roads(road_id) ON DELETE CASCADE,
  camera_name VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'ONLINE'
);
GRANT SELECT ON public.cctv_cameras TO anon, authenticated;
GRANT ALL ON public.cctv_cameras TO service_role;
ALTER TABLE public.cctv_cameras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cameras_public_read" ON public.cctv_cameras FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.vehicle_counts (
  reading_id BIGSERIAL PRIMARY KEY,
  road_id INT NOT NULL REFERENCES public.roads(road_id) ON DELETE CASCADE,
  vehicle_count INT NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'SIMULATED_SENSOR',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_counts_road_time_idx ON public.vehicle_counts (road_id, recorded_at DESC);
GRANT SELECT ON public.vehicle_counts TO anon, authenticated;
GRANT ALL ON public.vehicle_counts TO service_role;
ALTER TABLE public.vehicle_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "counts_public_read" ON public.vehicle_counts FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.signal_timings (
  timing_id SERIAL PRIMARY KEY,
  junction_id INT NOT NULL REFERENCES public.junctions(junction_id) ON DELETE CASCADE,
  road_id INT NOT NULL UNIQUE REFERENCES public.roads(road_id) ON DELETE CASCADE,
  timing_mode VARCHAR(10) NOT NULL DEFAULT 'ADAPTIVE',
  green_duration_sec INT NOT NULL DEFAULT 30,
  is_currently_green BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.signal_timings TO anon, authenticated;
GRANT ALL ON public.signal_timings TO service_role;
ALTER TABLE public.signal_timings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "timings_public_read" ON public.signal_timings FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.signal_history (
  history_id BIGSERIAL PRIMARY KEY,
  junction_id INT NOT NULL REFERENCES public.junctions(junction_id) ON DELETE CASCADE,
  road_id INT NOT NULL REFERENCES public.roads(road_id) ON DELETE CASCADE,
  vehicle_count_at_decision INT,
  allocated_green_sec INT NOT NULL,
  baseline_fixed_sec INT NOT NULL DEFAULT 30,
  estimated_wait_saved_sec INT NOT NULL DEFAULT 0,
  cycle_number BIGINT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX signal_history_junction_time_idx ON public.signal_history (junction_id, decided_at DESC);
GRANT SELECT ON public.signal_history TO anon, authenticated;
GRANT ALL ON public.signal_history TO service_role;
ALTER TABLE public.signal_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "history_public_read" ON public.signal_history FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.cctv_analysis_log (
  analysis_id BIGSERIAL PRIMARY KEY,
  camera_id INT NOT NULL REFERENCES public.cctv_cameras(camera_id) ON DELETE CASCADE,
  frame_number INT,
  vehicles_detected INT NOT NULL,
  confidence_avg DECIMAL(4,3),
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cctv_analysis_time_idx ON public.cctv_analysis_log (camera_id, analyzed_at DESC);
GRANT SELECT ON public.cctv_analysis_log TO anon, authenticated;
GRANT ALL ON public.cctv_analysis_log TO service_role;
ALTER TABLE public.cctv_analysis_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cctv_log_public_read" ON public.cctv_analysis_log FOR SELECT TO anon, authenticated USING (true);

CREATE VIEW public.v_junction_congestion WITH (security_invoker = on) AS
WITH latest AS (
  SELECT DISTINCT ON (vc.road_id) vc.road_id, vc.vehicle_count, vc.recorded_at
  FROM public.vehicle_counts vc
  ORDER BY vc.road_id, vc.recorded_at DESC
)
SELECT j.junction_id,
       j.name,
       j.latitude,
       j.longitude,
       COALESCE(ROUND(AVG(l.vehicle_count)::numeric, 1), 0) AS avg_vehicle_count,
       COALESCE(SUM(l.vehicle_count), 0) AS total_vehicle_count,
       CASE
         WHEN COALESCE(AVG(l.vehicle_count), 0) >= 60 THEN 'HIGH'
         WHEN COALESCE(AVG(l.vehicle_count), 0) >= 30 THEN 'MODERATE'
         ELSE 'LOW'
       END AS congestion_level,
       MAX(l.recorded_at) AS last_reading_at
FROM public.junctions j
LEFT JOIN public.roads r ON r.junction_id = j.junction_id
LEFT JOIN latest l ON l.road_id = r.road_id
GROUP BY j.junction_id, j.name, j.latitude, j.longitude;
GRANT SELECT ON public.v_junction_congestion TO anon, authenticated;

INSERT INTO public.junctions (name, latitude, longitude) VALUES
  ('Tambaram Junction', 12.9249000, 80.1000000),
  ('Vandalur Junction', 12.8930000, 80.0810000),
  ('Chengalpattu Bypass Junction', 12.6920000, 79.9770000),
  ('SRM Main Gate Junction', 12.8230000, 80.0450000),
  ('Guduvancheri Junction', 12.8420000, 80.0600000);

INSERT INTO public.roads (junction_id, direction, road_name, max_capacity)
SELECT j.junction_id, d.direction, j.name || ' - ' || initcap(lower(d.direction)) || ' Approach', 120
FROM public.junctions j
CROSS JOIN (VALUES ('NORTH'),('SOUTH'),('EAST'),('WEST')) AS d(direction);

INSERT INTO public.cctv_cameras (road_id, camera_name)
SELECT r.road_id, 'CAM-' || lpad(r.road_id::text, 3, '0') || ' ' || r.direction
FROM public.roads r;

INSERT INTO public.signal_timings (junction_id, road_id, timing_mode, green_duration_sec, is_currently_green)
SELECT r.junction_id, r.road_id, 'ADAPTIVE', 30, r.direction = 'NORTH'
FROM public.roads r;

INSERT INTO public.vehicle_counts (road_id, vehicle_count, source)
SELECT r.road_id, 20 + ((r.road_id * 13) % 55), 'SIMULATED_SENSOR'
FROM public.roads r;

INSERT INTO public.signal_history (junction_id, road_id, vehicle_count_at_decision, allocated_green_sec, baseline_fixed_sec, estimated_wait_saved_sec, cycle_number)
SELECT r.junction_id, r.road_id, 20 + ((r.road_id * 13) % 55), 30, 30, 0, 1
FROM public.roads r;
