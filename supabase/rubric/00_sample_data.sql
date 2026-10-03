-- Coursework sample history
-- ---------------------------------------------------------------------------
-- The live tables only hold the last few hours (prune_old_rows deletes the rest), which is too
-- little to write interesting report queries against. This script fills one past day,
-- 1 October 2026 (Chennai time), with a deterministic history so the same queries give the same
-- answers on every machine:
--
--   vehicle_counts   one reading per road every 30 minutes      (276 roads x 48 = 13,248 rows)
--   signal_history   one decision per road every 30 minutes     (13,248 rows)
--   phase_log        the busiest approach gets the green        (69 x 48 = 3,312 rows)
--   incidents        six incidents spread over the network (ids 9001 to 9006)
--
-- The numbers follow the same daily shape the simulator uses (morning peak near 9:00, evening peak
-- near 18:30) with a repeatable wobble instead of random noise. They are SAMPLE data, not
-- measurements. Run it on a scratch project or the local test database; 99_cleanup.sql removes
-- everything it adds. Safe to run more than once.

BEGIN;

DELETE FROM public.vehicle_counts
 WHERE recorded_at >= timestamptz '2026-10-01 00:00+05:30' AND recorded_at < timestamptz '2026-10-02 00:00+05:30';
DELETE FROM public.signal_history
 WHERE decided_at >= timestamptz '2026-10-01 00:00+05:30' AND decided_at < timestamptz '2026-10-02 00:00+05:30';
DELETE FROM public.phase_log
 WHERE started_at >= timestamptz '2026-10-01 00:00+05:30' AND started_at < timestamptz '2026-10-02 00:00+05:30';
DELETE FROM public.incidents
 WHERE starts_at >= timestamptz '2026-10-01 00:00+05:30' AND starts_at < timestamptz '2026-10-02 00:00+05:30';

CREATE TEMP TABLE cw_sample ON COMMIT DROP AS
SELECT r.road_id,
       r.junction_id,
       r.max_capacity,
       s AS slot,
       timestamptz '2026-10-01 00:00+05:30' + s * interval '30 minutes' AS ts,
       LEAST(
         150,
         GREATEST(
           0,
           round(
             r.max_capacity * 0.40
             * (0.45 + 1.3 * exp(-power(s / 2.0 - 9, 2) / 2.0)
                     + 1.45 * exp(-power(s / 2.0 - 18.5, 2) / 3.0)
                     + 0.6 * exp(-power(s / 2.0 - 13, 2) / 8.0))
             * (0.85 + 0.3 * abs(sin(r.road_id * 12.9898 + s * 78.233)))
             * (0.75 + 0.5 * ((r.junction_id * 37) % 10) / 9.0)
           )
         )
       )::int AS vehicles
FROM public.roads r
CROSS JOIN generate_series(0, 47) AS s;

INSERT INTO public.vehicle_counts (road_id, vehicle_count, source, recorded_at)
SELECT road_id, vehicles, 'SIMULATED_SENSOR', ts
FROM cw_sample
ORDER BY ts, road_id;

-- Adaptive timing is predicted to help most when a road is nearly full, and now and then it is
-- slightly worse on a quiet road, as the real model reports.
INSERT INTO public.signal_history (
  junction_id, road_id, vehicle_count_at_decision, allocated_green_sec, baseline_fixed_sec,
  estimated_wait_saved_sec, cycle_number, decided_at, degree_saturation,
  predicted_delay_adaptive_sec, predicted_delay_fixed_sec, cycle_length_sec
)
SELECT junction_id,
       road_id,
       vehicles,
       LEAST(90, GREATEST(12, round(vehicles * 0.45 + 14)))::int,
       30,
       round((fixed - adaptive) * vehicles / 12.0)::int,
       1000000 + slot,
       ts,
       round(LEAST(1.4, vehicles::numeric / max_capacity), 2),
       adaptive,
       fixed,
       120
FROM (
  SELECT cs.*,
         round((25 + 70 * power(LEAST(1.4, cs.vehicles::numeric / cs.max_capacity), 2))::numeric, 1) AS fixed,
         round(
           ((25 + 70 * power(LEAST(1.4, cs.vehicles::numeric / cs.max_capacity), 2))
            * CASE WHEN (cs.road_id + cs.slot) % 11 = 0 THEN 1.02
                   ELSE 0.96 - 0.22 * LEAST(1, cs.vehicles::numeric / cs.max_capacity) END)::numeric, 1
         ) AS adaptive
  FROM cw_sample cs
) x
ORDER BY ts, road_id;

INSERT INTO public.phase_log (junction_id, road_id, green_duration_sec, started_at)
SELECT DISTINCT ON (junction_id, slot)
       junction_id, road_id, LEAST(90, GREATEST(12, round(vehicles * 0.45 + 14)))::int, ts
FROM cw_sample
ORDER BY junction_id, slot, vehicles DESC, road_id;

INSERT INTO public.incidents (incident_id, junction_id, road_id, kind, note, starts_at, ends_at)
SELECT v.iid, v.jid, r.road_id, v.kind, 'sample: ' || lower(v.kind), v.starts_at, v.ends_at
FROM (VALUES
  (9001, 3,  'ACCIDENT',     timestamptz '2026-10-01 08:40+05:30', timestamptz '2026-10-01 10:10+05:30'),
  (9002, 12, 'LANE_BLOCKED', timestamptz '2026-10-01 17:30+05:30', timestamptz '2026-10-01 18:45+05:30'),
  (9003, 25, 'ROADWORK',     timestamptz '2026-10-01 10:00+05:30', timestamptz '2026-10-01 15:00+05:30'),
  (9004, 31, 'LANE_BLOCKED', timestamptz '2026-10-01 09:00+05:30', timestamptz '2026-10-01 09:40+05:30'),
  (9005, 47, 'SIGNAL_FAULT', timestamptz '2026-10-01 18:00+05:30', timestamptz '2026-10-01 19:30+05:30'),
  (9006, 58, 'ACCIDENT',     timestamptz '2026-10-01 12:15+05:30', timestamptz '2026-10-01 13:00+05:30')
) AS v(iid, jid, kind, starts_at, ends_at)
JOIN LATERAL (
  SELECT road_id FROM public.roads WHERE junction_id = v.jid ORDER BY road_id LIMIT 1
) r ON true;

COMMIT;
