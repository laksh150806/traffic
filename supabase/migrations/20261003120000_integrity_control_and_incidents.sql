-- Integrity, a safe control loop, and incidents.
--
-- 1. Natural keys, ranges and a composite foreign key so a child row can never name a
--    junction that is not its road's junction.
-- 2. At most one green per junction, enforced by the database rather than by app code.
-- 3. A throttle the two control loops must pass, so many open tabs (or a flood of
--    requests) cannot multiply the work.
-- 4. Set-based functions for the control loop's writes, a trigger that logs every phase
--    change, and one function that owns data retention.
-- 5. Views the app reads instead of pulling raw rows, and indexes for the hot queries.
--
-- Safe to run twice.

-- ---------------------------------------------------------------------------
-- 0. Helper (lives only for this session)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.ensure_constraint(p_table regclass, p_name text, p_definition text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = p_table AND conname = p_name
  ) THEN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', p_table, p_name, p_definition);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Keys and ranges
-- ---------------------------------------------------------------------------
SELECT pg_temp.ensure_constraint('public.junctions', 'junctions_name_key', 'UNIQUE (name)');
SELECT pg_temp.ensure_constraint('public.junctions', 'junctions_latitude_chk', 'CHECK (latitude BETWEEN -90 AND 90)');
SELECT pg_temp.ensure_constraint('public.junctions', 'junctions_longitude_chk', 'CHECK (longitude BETWEEN -180 AND 180)');
SELECT pg_temp.ensure_constraint('public.junctions', 'junctions_status_chk', $c$CHECK (status IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE'))$c$);

SELECT pg_temp.ensure_constraint('public.roads', 'roads_direction_chk', $c$CHECK (direction IN ('NORTH', 'SOUTH', 'EAST', 'WEST'))$c$);
SELECT pg_temp.ensure_constraint('public.roads', 'roads_capacity_chk', 'CHECK (max_capacity BETWEEN 10 AND 500)');
-- The target of the composite foreign keys below.
SELECT pg_temp.ensure_constraint('public.roads', 'roads_road_junction_key', 'UNIQUE (road_id, junction_id)');

SELECT pg_temp.ensure_constraint('public.cctv_cameras', 'cameras_status_chk', $c$CHECK (status IN ('ONLINE', 'OFFLINE'))$c$);

SELECT pg_temp.ensure_constraint('public.vehicle_counts', 'counts_nonnegative_chk', 'CHECK (vehicle_count >= 0)');
SELECT pg_temp.ensure_constraint('public.vehicle_counts', 'counts_source_chk', $c$CHECK (source IN ('SIMULATED_SENSOR', 'SENSOR', 'MANUAL'))$c$);

SELECT pg_temp.ensure_constraint('public.cctv_analysis_log', 'cctv_confidence_chk', 'CHECK (confidence_avg IS NULL OR confidence_avg BETWEEN 0 AND 1)');
SELECT pg_temp.ensure_constraint('public.cctv_analysis_log', 'cctv_detected_chk', 'CHECK (vehicles_detected >= 0)');

-- junction_id is determined by road_id, so it is kept consistent with a composite key
-- instead of trusting every writer to repeat it correctly.
SELECT pg_temp.ensure_constraint('public.signal_timings', 'timings_road_junction_fk',
  'FOREIGN KEY (road_id, junction_id) REFERENCES public.roads (road_id, junction_id) ON DELETE CASCADE');
SELECT pg_temp.ensure_constraint('public.signal_timings', 'timings_mode_chk', $c$CHECK (timing_mode IN ('ADAPTIVE', 'FIXED'))$c$);
SELECT pg_temp.ensure_constraint('public.signal_timings', 'timings_green_chk', 'CHECK (green_duration_sec BETWEEN 5 AND 150)');

SELECT pg_temp.ensure_constraint('public.signal_history', 'history_road_junction_fk',
  'FOREIGN KEY (road_id, junction_id) REFERENCES public.roads (road_id, junction_id) ON DELETE CASCADE');
SELECT pg_temp.ensure_constraint('public.signal_history', 'history_green_chk', 'CHECK (allocated_green_sec > 0)');
SELECT pg_temp.ensure_constraint('public.signal_history', 'history_cycle_chk', 'CHECK (cycle_number IS NULL OR cycle_number >= 0)');

SELECT pg_temp.ensure_constraint('public.model_road_state', 'model_state_road_junction_fk',
  'FOREIGN KEY (road_id, junction_id) REFERENCES public.roads (road_id, junction_id) ON DELETE CASCADE');
SELECT pg_temp.ensure_constraint('public.model_road_state', 'model_state_ranges_chk',
  'CHECK (degree_saturation >= 0 AND queue_now >= 0 AND arrival_rate_vph >= 0 AND saturation_flow_vph > 0)');

SELECT pg_temp.ensure_constraint('public.model_accuracy', 'accuracy_road_junction_fk',
  'FOREIGN KEY (road_id, junction_id) REFERENCES public.roads (road_id, junction_id) ON DELETE CASCADE');

-- The queue the naive guess "nothing changes" would have predicted, to compare against.
ALTER TABLE public.model_accuracy ADD COLUMN IF NOT EXISTS baseline_queue integer;

-- The error is a function of the two queues, so the database computes it.
ALTER TABLE public.model_accuracy DROP COLUMN IF EXISTS abs_error;
ALTER TABLE public.model_accuracy
  ADD COLUMN abs_error numeric GENERATED ALWAYS AS (abs(predicted_queue - actual_queue)) STORED;

-- ---------------------------------------------------------------------------
-- 2. One green per junction
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS signal_timings_one_green_per_junction
  ON public.signal_timings (junction_id)
  WHERE is_currently_green;

-- ---------------------------------------------------------------------------
-- 3. Indexes for the hot queries (the retention deletes filter on time alone)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS vehicle_counts_recorded_idx ON public.vehicle_counts (recorded_at);
CREATE INDEX IF NOT EXISTS signal_history_decided_idx ON public.signal_history (decided_at);
CREATE INDEX IF NOT EXISTS signal_history_road_idx ON public.signal_history (road_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS cctv_analysis_analyzed_idx ON public.cctv_analysis_log (analyzed_at);
CREATE INDEX IF NOT EXISTS cctv_cameras_road_idx ON public.cctv_cameras (road_id);
CREATE INDEX IF NOT EXISTS signal_timings_junction_idx ON public.signal_timings (junction_id);

-- ---------------------------------------------------------------------------
-- 4. Control-loop throttle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.control_state (
  name        text PRIMARY KEY,
  last_run_at timestamptz NOT NULL DEFAULT 'epoch'
);
ALTER TABLE public.control_state ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.control_state TO service_role;
-- No policy on purpose: only the server (service role) ever touches it.

-- True for exactly one caller per interval, however many call at once: the row lock
-- taken by the upsert serialises them and the WHERE clause rejects the late ones.
CREATE OR REPLACE FUNCTION public.try_acquire_control(p_name text, p_min_interval_ms integer)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  claimed integer;
BEGIN
  INSERT INTO public.control_state AS c (name, last_run_at)
  VALUES (p_name, clock_timestamp())
  ON CONFLICT (name) DO UPDATE
    SET last_run_at = clock_timestamp()
    WHERE c.last_run_at <= clock_timestamp() - make_interval(secs => p_min_interval_ms / 1000.0);
  GET DIAGNOSTICS claimed = ROW_COUNT;
  RETURN claimed > 0;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Incidents and the phase log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.incidents (
  incident_id bigserial PRIMARY KEY,
  junction_id integer NOT NULL REFERENCES public.junctions (junction_id) ON DELETE CASCADE,
  road_id     integer NOT NULL,
  kind        text NOT NULL DEFAULT 'LANE_BLOCKED'
              CHECK (kind IN ('LANE_BLOCKED', 'ACCIDENT', 'ROADWORK', 'SIGNAL_FAULT')),
  note        text,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incidents_window_chk CHECK (ends_at > starts_at),
  CONSTRAINT incidents_road_junction_fk FOREIGN KEY (road_id, junction_id)
    REFERENCES public.roads (road_id, junction_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS incidents_active_idx ON public.incidents (ends_at, junction_id);
GRANT SELECT ON public.incidents TO anon, authenticated;
GRANT ALL ON public.incidents TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.incidents_incident_id_seq TO service_role;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "incidents_public_read" ON public.incidents;
CREATE POLICY "incidents_public_read" ON public.incidents FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.phase_log (
  log_id             bigserial PRIMARY KEY,
  junction_id        integer NOT NULL REFERENCES public.junctions (junction_id) ON DELETE CASCADE,
  road_id            integer NOT NULL REFERENCES public.roads (road_id) ON DELETE CASCADE,
  green_duration_sec integer NOT NULL,
  started_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phase_log_started_idx ON public.phase_log (started_at);
CREATE INDEX IF NOT EXISTS phase_log_junction_idx ON public.phase_log (junction_id, started_at DESC);
GRANT SELECT ON public.phase_log TO anon, authenticated;
GRANT ALL ON public.phase_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.phase_log_log_id_seq TO service_role;
ALTER TABLE public.phase_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "phase_log_public_read" ON public.phase_log;
CREATE POLICY "phase_log_public_read" ON public.phase_log FOR SELECT TO anon, authenticated USING (true);

-- Every time an approach is given the green, record it.
CREATE OR REPLACE FUNCTION public.log_phase_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_currently_green AND NOT OLD.is_currently_green THEN
    INSERT INTO public.phase_log (junction_id, road_id, green_duration_sec, started_at)
    VALUES (NEW.junction_id, NEW.road_id, NEW.green_duration_sec, NEW.updated_at);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_log_phase_change ON public.signal_timings;
CREATE TRIGGER trg_log_phase_change
  AFTER UPDATE OF is_currently_green ON public.signal_timings
  FOR EACH ROW
  EXECUTE FUNCTION public.log_phase_change();

-- ---------------------------------------------------------------------------
-- 6. Set-based writes for the control loop
-- ---------------------------------------------------------------------------

-- Re-plan the green times without touching who is green or since when, so a plan
-- written a moment late can never undo a phase change made in between.
CREATE OR REPLACE FUNCTION public.apply_green_allocations(p jsonb)
RETURNS integer
LANGUAGE sql
AS $$
  WITH changed AS (
    UPDATE public.signal_timings t
       SET green_duration_sec = x.green
      FROM jsonb_to_recordset(p) AS x(road_id integer, green integer)
     WHERE t.road_id = x.road_id
       AND t.green_duration_sec IS DISTINCT FROM x.green
    RETURNING 1
  )
  SELECT count(*)::integer FROM changed;
$$;

-- Hand the green over, junction by junction. A junction whose change fails (for
-- example another call already moved its green) is skipped; the rest still apply.
CREATE OR REPLACE FUNCTION public.apply_phase_changes(p jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  chg      record;
  switched integer := 0;
  touched  integer;
BEGIN
  FOR chg IN
    SELECT * FROM jsonb_to_recordset(p) AS x(end_road integer, start_road integer, green integer)
  LOOP
    BEGIN
      IF chg.end_road IS NOT NULL THEN
        UPDATE public.signal_timings
           SET is_currently_green = false, updated_at = clock_timestamp()
         WHERE road_id = chg.end_road AND is_currently_green;
      END IF;

      UPDATE public.signal_timings
         SET is_currently_green = true,
             green_duration_sec = chg.green,
             updated_at = clock_timestamp()
       WHERE road_id = chg.start_road AND NOT is_currently_green;
      GET DIAGNOSTICS touched = ROW_COUNT;
      switched := switched + touched;
    EXCEPTION WHEN unique_violation THEN
      -- Someone else holds the green at this junction now; leave it alone.
      NULL;
    END;
  END LOOP;
  RETURN switched;
END
$$;

-- The one place that decides how much history is kept.
CREATE OR REPLACE FUNCTION public.prune_old_rows()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  n_counts integer;
  n_cctv integer;
  n_history integer;
  n_accuracy integer;
  n_phases integer;
  n_incidents integer;
BEGIN
  DELETE FROM public.vehicle_counts WHERE recorded_at < now() - interval '25 minutes';
  GET DIAGNOSTICS n_counts = ROW_COUNT;
  DELETE FROM public.cctv_analysis_log WHERE analyzed_at < now() - interval '60 minutes';
  GET DIAGNOSTICS n_cctv = ROW_COUNT;
  DELETE FROM public.signal_history WHERE decided_at < now() - interval '90 minutes';
  GET DIAGNOSTICS n_history = ROW_COUNT;
  DELETE FROM public.model_accuracy WHERE recorded_at < now() - interval '60 minutes';
  GET DIAGNOSTICS n_accuracy = ROW_COUNT;
  DELETE FROM public.phase_log WHERE started_at < now() - interval '30 minutes';
  GET DIAGNOSTICS n_phases = ROW_COUNT;
  DELETE FROM public.incidents WHERE ends_at < now() - interval '1 day';
  GET DIAGNOSTICS n_incidents = ROW_COUNT;

  RETURN jsonb_build_object(
    'vehicle_counts', n_counts,
    'cctv_analysis_log', n_cctv,
    'signal_history', n_history,
    'model_accuracy', n_accuracy,
    'phase_log', n_phases,
    'incidents', n_incidents
  );
END
$$;

REVOKE ALL ON FUNCTION public.try_acquire_control(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_green_allocations(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_phase_changes(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_old_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_control(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_green_allocations(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_phase_changes(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_old_rows() TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Views
-- ---------------------------------------------------------------------------

-- Latest reading per road, and the latest cycle number per junction.
CREATE OR REPLACE VIEW public.v_latest_vehicle_count WITH (security_invoker = on) AS
SELECT DISTINCT ON (vc.road_id) vc.road_id, vc.vehicle_count, vc.recorded_at
FROM public.vehicle_counts vc
ORDER BY vc.road_id, vc.recorded_at DESC;

CREATE OR REPLACE VIEW public.v_junction_cycle WITH (security_invoker = on) AS
SELECT sh.junction_id, max(sh.cycle_number) AS cycle_number
FROM public.signal_history sh
GROUP BY sh.junction_id;

-- Modelled waiting avoided over the last hour, whole network. Signed: a negative total
-- means the adaptive plan was predicted to wait longer than the fixed timer overall.
CREATE OR REPLACE VIEW public.v_modelled_saving WITH (security_invoker = on) AS
SELECT COALESCE(sum(sh.estimated_wait_saved_sec), 0)::bigint AS seconds,
       LEAST(60, GREATEST(1, ceil(extract(epoch FROM (now() - min(sh.decided_at))) / 60)))::integer AS window_min
FROM public.signal_history sh
WHERE sh.decided_at > now() - interval '60 minutes';

-- Junction colour: mean saturation sets the base level and a long queue on any single
-- arm raises it, so one jammed arm is never reported as free flowing.
DROP VIEW IF EXISTS public.v_junction_congestion;
CREATE VIEW public.v_junction_congestion WITH (security_invoker = on) AS
WITH model AS (
  SELECT m.junction_id,
         avg(m.degree_saturation) AS avg_saturation,
         sum(m.arrival_rate_vph) AS arrival_rate_vph,
         CASE WHEN sum(m.arrival_rate_vph) > 0
              THEN sum(m.predicted_delay_adaptive_sec * m.arrival_rate_vph) / sum(m.arrival_rate_vph)
              ELSE 0 END AS predicted_delay_sec
  FROM public.model_road_state m
  GROUP BY m.junction_id
)
SELECT j.junction_id,
       j.name,
       j.zone,
       j.latitude,
       j.longitude,
       COALESCE(round(avg(l.vehicle_count), 1), 0::numeric) AS avg_vehicle_count,
       COALESCE(sum(l.vehicle_count), 0::bigint) AS total_vehicle_count,
       COALESCE(round(max(mo.avg_saturation), 2), 0::numeric) AS avg_saturation,
       COALESCE(round(max(mo.arrival_rate_vph), 0), 0::numeric) AS arrival_rate_vph,
       COALESCE(round(max(mo.predicted_delay_sec), 1), 0::numeric) AS predicted_delay_sec,
       CASE
         WHEN COALESCE(max(mo.avg_saturation), 0) >= 0.95 OR COALESCE(max(l.vehicle_count), 0) >= 80 THEN 'HIGH'::text
         WHEN COALESCE(max(mo.avg_saturation), 0) >= 0.75 OR COALESCE(max(l.vehicle_count), 0) >= 40 THEN 'MODERATE'::text
         ELSE 'LOW'::text
       END AS congestion_level,
       max(l.recorded_at) AS last_reading_at,
       COALESCE(max(l.vehicle_count), 0) AS max_vehicle_count
FROM public.junctions j
LEFT JOIN public.roads r ON r.junction_id = j.junction_id
LEFT JOIN public.v_latest_vehicle_count l ON l.road_id = r.road_id
LEFT JOIN model mo ON mo.junction_id = j.junction_id
GROUP BY j.junction_id, j.name, j.zone, j.latitude, j.longitude;

GRANT SELECT ON public.v_latest_vehicle_count TO anon, authenticated, service_role;
GRANT SELECT ON public.v_junction_cycle TO anon, authenticated, service_role;
GRANT SELECT ON public.v_modelled_saving TO anon, authenticated, service_role;
GRANT SELECT ON public.v_junction_congestion TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Say what the columns mean
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.roads.max_capacity IS
  'Capacity index of the approach (100 = one ordinary lane group). The model scales its saturation flow by it (1800 veh/h x max_capacity / 100, kept between 900 and 2400); it is not a count of vehicles that fit on the road.';
COMMENT ON COLUMN public.signal_history.cycle_number IS
  'Number of the control update that produced this row (one per model tick, about every 12 s), not a signal cycle.';
COMMENT ON COLUMN public.signal_history.estimated_wait_saved_sec IS
  'Modelled vehicle-seconds of waiting avoided in the window this row covers: (fixed-timer delay - adaptive delay) x vehicles that arrived. Signed; negative where the adaptive plan is predicted to wait longer.';
COMMENT ON COLUMN public.signal_timings.updated_at IS
  'When this approach last changed colour (green to red or red to green). The control tick never touches it.';
