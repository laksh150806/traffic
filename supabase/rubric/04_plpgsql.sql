-- Rubric item 4: PL/pgSQL trigger, cursor and procedure (5 marks)
-- ---------------------------------------------------------------------------
-- The app already has one trigger (log_phase_change, shown in T0). The objects below are the
-- coursework ones. They sit on their own tables (cw_sensor_intake, cw_alert, cw_daily_report) so
-- the live control loop is never slowed or rejected by them.

-- Supporting tables ---------------------------------------------------------------------------

-- Manually submitted sensor readings. A reading is checked on the way in and, if it is
-- acceptable, copied into vehicle_counts.
CREATE TABLE IF NOT EXISTS public.cw_sensor_intake (
  intake_id     bigserial PRIMARY KEY,
  road_id       integer NOT NULL REFERENCES public.roads (road_id) ON DELETE CASCADE,
  vehicle_count integer NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'NEW'
);

CREATE TABLE IF NOT EXISTS public.cw_alert (
  alert_id      bigserial PRIMARY KEY,
  road_id       integer NOT NULL REFERENCES public.roads (road_id) ON DELETE CASCADE,
  junction_id   integer NOT NULL REFERENCES public.junctions (junction_id) ON DELETE CASCADE,
  vehicle_count integer NOT NULL,
  max_capacity  integer NOT NULL,
  message       text NOT NULL,
  raised_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cw_daily_report (
  report_day        date NOT NULL,
  junction_id       integer NOT NULL REFERENCES public.junctions (junction_id) ON DELETE CASCADE,
  name              text NOT NULL,
  zone              text NOT NULL,
  total_vehicles    bigint NOT NULL,
  peak_vehicles     integer NOT NULL,
  peak_time_ist     text,
  avg_green_sec     numeric,
  vehicle_sec_saved bigint NOT NULL DEFAULT 0,
  incidents         integer NOT NULL DEFAULT 0,
  grade             text NOT NULL,
  PRIMARY KEY (report_day, junction_id)
);

-- A plain function: grade a junction by how close its busiest half hour came to its capacity.
CREATE OR REPLACE FUNCTION public.cw_grade(p_peak integer, p_capacity integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_ratio numeric := p_peak / NULLIF(p_capacity * 4.0, 0);   -- four approaches share the junction
BEGIN
  IF v_ratio IS NULL THEN RETURN 'n/a'; END IF;
  IF v_ratio >= 0.9 THEN RETURN 'D';
  ELSIF v_ratio >= 0.7 THEN RETURN 'C';
  ELSIF v_ratio >= 0.5 THEN RETURN 'B';
  ELSE RETURN 'A';
  END IF;
END
$$;

-- Trigger 1 (BEFORE INSERT, row level): validate the reading before it is stored. It can reject
-- the row with an error, or change it by editing NEW.
CREATE OR REPLACE FUNCTION public.cw_check_intake()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_capacity integer;
BEGIN
  SELECT max_capacity INTO v_capacity FROM public.roads WHERE road_id = NEW.road_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'road % does not exist', NEW.road_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.vehicle_count < 0 THEN
    RAISE EXCEPTION 'negative vehicle count (%) on road %', NEW.vehicle_count, NEW.road_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.vehicle_count > 3 * v_capacity THEN
    RAISE EXCEPTION 'reading % is more than three times the capacity (%) of road %',
      NEW.vehicle_count, v_capacity, NEW.road_id USING ERRCODE = 'check_violation';
  END IF;
  NEW.status := CASE WHEN NEW.vehicle_count > 1.5 * v_capacity THEN 'ACCEPTED_OVERLOAD' ELSE 'ACCEPTED' END;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS cw_trg_check_intake ON public.cw_sensor_intake;
CREATE TRIGGER cw_trg_check_intake
  BEFORE INSERT ON public.cw_sensor_intake
  FOR EACH ROW EXECUTE FUNCTION public.cw_check_intake();

-- Trigger 2 (AFTER INSERT, row level): act on an accepted reading. Copy it to vehicle_counts and
-- raise an alert when the road is more than 50 % over capacity.
CREATE OR REPLACE FUNCTION public.cw_forward_intake()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_road public.roads%ROWTYPE;
BEGIN
  SELECT * INTO v_road FROM public.roads WHERE road_id = NEW.road_id;
  INSERT INTO public.vehicle_counts (road_id, vehicle_count, source, recorded_at)
  VALUES (NEW.road_id, NEW.vehicle_count, 'MANUAL', NEW.recorded_at);
  IF NEW.status = 'ACCEPTED_OVERLOAD' THEN
    INSERT INTO public.cw_alert (road_id, junction_id, vehicle_count, max_capacity, message)
    VALUES (v_road.road_id, v_road.junction_id, NEW.vehicle_count, v_road.max_capacity,
            format('%s approach holds %s vehicles against a capacity of %s',
                   v_road.direction, NEW.vehicle_count, v_road.max_capacity));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS cw_trg_forward_intake ON public.cw_sensor_intake;
CREATE TRIGGER cw_trg_forward_intake
  AFTER INSERT ON public.cw_sensor_intake
  FOR EACH ROW EXECUTE FUNCTION public.cw_forward_intake();

-- A helper for the demonstration: try a submission and report what the trigger said instead of
-- aborting the whole script. (An EXCEPTION block in PL/pgSQL rolls back just that block.)
CREATE OR REPLACE FUNCTION public.cw_try_submit(p_road integer, p_count integer)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.cw_sensor_intake (road_id, vehicle_count) VALUES (p_road, p_count);
  RETURN format('road %s, %s vehicles: accepted', p_road, p_count);
EXCEPTION
  WHEN check_violation OR foreign_key_violation THEN
    RETURN format('road %s, %s vehicles: rejected (%s)', p_road, p_count, SQLERRM);
END
$$;

-- Cursor procedure: build the daily report one junction at a time. An explicit cursor with a
-- parameter walks the junctions; each is looked up, graded and written. INOUT p_rows returns how
-- many rows were written.
CREATE OR REPLACE PROCEDURE public.cw_build_daily_report(p_day date, p_zone_pattern text DEFAULT '%', INOUT p_rows integer DEFAULT 0)
LANGUAGE plpgsql
AS $$
DECLARE
  cur CURSOR (zone_like text) FOR
    SELECT j.junction_id, j.name, j.zone, COALESCE(max(r.max_capacity), 100) AS capacity
    FROM public.junctions j
    LEFT JOIN public.roads r ON r.junction_id = j.junction_id
    WHERE j.zone LIKE zone_like
    GROUP BY j.junction_id, j.name, j.zone
    ORDER BY j.junction_id;
  rec         record;
  v_total     bigint;
  v_peak      integer;
  v_peak_time text;
  v_green     numeric;
  v_saved     bigint;
  v_incidents integer;
BEGIN
  IF p_day IS NULL THEN
    RAISE EXCEPTION 'the report day is required';
  END IF;
  p_rows := 0;
  DELETE FROM public.cw_daily_report WHERE report_day = p_day AND zone LIKE p_zone_pattern;

  OPEN cur(p_zone_pattern);
  LOOP
    FETCH cur INTO rec;
    EXIT WHEN NOT FOUND;

    SELECT COALESCE(sum(s.vehicles), 0), COALESCE(max(s.vehicles), 0)
      INTO v_total, v_peak
      FROM public.cw_slot_totals s
     WHERE s.junction_id = rec.junction_id
       AND ((s.recorded_at AT TIME ZONE 'UTC') + interval '5 hours 30 minutes')::date = p_day;

    SELECT to_char((s.recorded_at AT TIME ZONE 'UTC') + interval '5 hours 30 minutes', 'HH24:MI')
      INTO v_peak_time
      FROM public.cw_slot_totals s
     WHERE s.junction_id = rec.junction_id
       AND ((s.recorded_at AT TIME ZONE 'UTC') + interval '5 hours 30 minutes')::date = p_day
     ORDER BY s.vehicles DESC, s.recorded_at
     LIMIT 1;

    SELECT round(avg(sh.allocated_green_sec), 1), COALESCE(sum(sh.estimated_wait_saved_sec), 0)
      INTO v_green, v_saved
      FROM public.signal_history sh
     WHERE sh.junction_id = rec.junction_id
       AND ((sh.decided_at AT TIME ZONE 'UTC') + interval '5 hours 30 minutes')::date = p_day;

    SELECT count(*) INTO v_incidents
      FROM public.incidents i
     WHERE i.junction_id = rec.junction_id
       AND ((i.starts_at AT TIME ZONE 'UTC') + interval '5 hours 30 minutes')::date = p_day;

    INSERT INTO public.cw_daily_report
      (report_day, junction_id, name, zone, total_vehicles, peak_vehicles, peak_time_ist,
       avg_green_sec, vehicle_sec_saved, incidents, grade)
    VALUES
      (p_day, rec.junction_id, rec.name, rec.zone, v_total, v_peak, v_peak_time,
       v_green, v_saved, v_incidents, public.cw_grade(v_peak, rec.capacity));
    p_rows := p_rows + 1;
  END LOOP;
  CLOSE cur;
END
$$;

-- A second cursor style: a function that opens a named refcursor and hands it back, so the caller
-- can FETCH from it a few rows at a time.
CREATE OR REPLACE FUNCTION public.cw_open_busiest(p_zone text, p_cursor refcursor DEFAULT 'busiest')
RETURNS refcursor
LANGUAGE plpgsql
AS $$
BEGIN
  OPEN p_cursor FOR
    SELECT name, peak_vehicles, rank_in_zone
    FROM public.cw_junction_peak
    WHERE zone = p_zone
    ORDER BY peak_vehicles DESC, junction_id;
  RETURN p_cursor;
END
$$;

-- Procedure with a business rule: close an incident early. Raises when the incident is unknown or
-- already over. INOUT p_minutes_early reports how much earlier it ended than planned.
CREATE OR REPLACE PROCEDURE public.cw_resolve_incident(p_incident bigint, INOUT p_minutes_early integer DEFAULT 0, p_at timestamptz DEFAULT now())
LANGUAGE plpgsql
AS $$
DECLARE
  v_ends timestamptz;
  v_starts timestamptz;
BEGIN
  SELECT starts_at, ends_at INTO v_starts, v_ends
    FROM public.incidents WHERE incident_id = p_incident FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident % does not exist', p_incident USING ERRCODE = 'no_data_found';
  END IF;
  IF v_ends <= p_at THEN
    RAISE EXCEPTION 'incident % is already over', p_incident;
  END IF;
  UPDATE public.incidents SET ends_at = GREATEST(p_at, v_starts + interval '1 second')
   WHERE incident_id = p_incident;
  p_minutes_early := round(extract(epoch FROM (v_ends - p_at)) / 60);
END
$$;

-- Demonstrations --------------------------------------------------------------------------------

-- T0  The trigger the app already has (log_phase_change): giving an approach the green writes a
-- row to phase_log. Junction 1 is set to red everywhere, then its first approach is given the green.
UPDATE public.signal_timings SET is_currently_green = false WHERE junction_id = 1;

UPDATE public.signal_timings SET is_currently_green = true
 WHERE road_id = (SELECT min(road_id) FROM public.roads WHERE junction_id = 1);

SELECT p.log_id, p.junction_id, p.road_id, p.green_duration_sec, (p.started_at > timestamptz '2026-10-02') AS logged_by_trigger
FROM public.phase_log p
WHERE p.junction_id = 1
ORDER BY p.log_id DESC
LIMIT 2;

-- T1  Trigger 1 and 2: four submissions. One normal, one far over capacity (accepted, alert raised),
-- one impossible, one for a road that does not exist.
SELECT public.cw_try_submit(1, 40) AS result
UNION ALL SELECT public.cw_try_submit(1, 190)
UNION ALL SELECT public.cw_try_submit(1, 900)
UNION ALL SELECT public.cw_try_submit(99999, 10);

-- T2  What the triggers left behind: the intake log (the rejected rows are gone), the copy in
-- vehicle_counts, and the alert.
SELECT intake_id, road_id, vehicle_count, status FROM public.cw_sensor_intake ORDER BY intake_id;

SELECT road_id, vehicle_count, source FROM public.vehicle_counts WHERE source = 'MANUAL' ORDER BY reading_id;

SELECT road_id, junction_id, vehicle_count, max_capacity, message FROM public.cw_alert ORDER BY alert_id;

-- T3  The cursor procedure: build the report for the sample day. The result row is the INOUT
-- count of junctions written.
CALL public.cw_build_daily_report(DATE '2026-10-01', '%', NULL);

SELECT junction_id, name, zone, total_vehicles, peak_vehicles, peak_time_ist, avg_green_sec, vehicle_sec_saved, incidents, grade
FROM public.cw_daily_report
WHERE report_day = DATE '2026-10-01'
ORDER BY total_vehicles DESC, junction_id
LIMIT 8;

-- T4  Grades across the network.
SELECT grade, count(*) AS junctions, round(avg(peak_vehicles), 0) AS avg_peak
FROM public.cw_daily_report
WHERE report_day = DATE '2026-10-01'
GROUP BY grade
ORDER BY grade;

-- T5  The refcursor function: open a cursor on the busiest junctions of the GST Corridor and fetch
-- from it in two steps (a cursor lives inside a transaction).
BEGIN;

SELECT public.cw_open_busiest('GST Corridor') AS cursor_name;

FETCH 3 FROM busiest;

FETCH 2 FROM busiest;

CLOSE busiest;

COMMIT;

-- T6  The resolve procedure: end the accident at junction 3 (08:40 to 10:10) at 09:10. The result is
-- how many minutes early it ended.
CALL public.cw_resolve_incident(9001, NULL, timestamptz '2026-10-01 09:10+05:30');

SELECT incident_id, kind, round(extract(epoch FROM (ends_at - starts_at)) / 60) AS minutes_open
FROM public.incidents WHERE incident_id = 9001;
