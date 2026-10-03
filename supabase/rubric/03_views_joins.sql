-- Rubric item 3: Views and joins (5 marks)
-- ---------------------------------------------------------------------------
-- Four views (one built on another) and seven join queries: inner, left, right, full outer,
-- self, cross, and a four-table join with a time condition. The views are prefixed cw_ so they
-- are easy to tell from the ones the app uses; 99_cleanup.sql drops them.

-- V1  Join of vehicle_counts and roads: vehicles arriving at each junction in each half hour.
CREATE OR REPLACE VIEW public.cw_slot_totals AS
SELECT r.junction_id,
       vc.recorded_at,
       sum(vc.vehicle_count)::int AS vehicles
FROM public.vehicle_counts vc
JOIN public.roads r USING (road_id)
GROUP BY r.junction_id, vc.recorded_at;

-- V2  A view built on a view, with a window function: each junction's peak and its rank in its zone.
CREATE OR REPLACE VIEW public.cw_junction_peak AS
SELECT j.junction_id,
       j.name,
       j.zone,
       max(s.vehicles) AS peak_vehicles,
       round(avg(s.vehicles), 1) AS avg_vehicles,
       rank() OVER (PARTITION BY j.zone ORDER BY max(s.vehicles) DESC) AS rank_in_zone
FROM public.junctions j
JOIN public.cw_slot_totals s USING (junction_id)
GROUP BY j.junction_id, j.name, j.zone;

-- V3  Adaptive against the fixed timer, per junction (joins junctions to signal_history).
CREATE OR REPLACE VIEW public.cw_adaptive_vs_fixed AS
SELECT j.junction_id,
       j.name,
       j.zone,
       round(avg(sh.predicted_delay_fixed_sec), 1) AS avg_delay_fixed_sec,
       round(avg(sh.predicted_delay_adaptive_sec), 1) AS avg_delay_adaptive_sec,
       sum(sh.estimated_wait_saved_sec) AS vehicle_seconds_saved,
       count(*) FILTER (WHERE sh.predicted_delay_adaptive_sec > sh.predicted_delay_fixed_sec) AS decisions_worse,
       count(*) AS decisions
FROM public.junctions j
JOIN public.signal_history sh USING (junction_id)
GROUP BY j.junction_id, j.name, j.zone;

-- V4  Incident report: three tables joined, with the duration worked out.
CREATE OR REPLACE VIEW public.cw_incident_report AS
SELECT i.incident_id,
       j.name AS junction,
       j.zone,
       r.direction AS approach,
       i.kind,
       round(extract(epoch FROM (i.ends_at - i.starts_at)) / 60) AS minutes
FROM public.incidents i
JOIN public.junctions j USING (junction_id)
JOIN public.roads r ON r.road_id = i.road_id AND r.junction_id = i.junction_id;

-- J1  Inner join through a view: the five junctions where adaptive timing saved the most waiting.
SELECT name, zone, avg_delay_fixed_sec, avg_delay_adaptive_sec, vehicle_seconds_saved
FROM public.cw_adaptive_vs_fixed
ORDER BY vehicle_seconds_saved DESC
LIMIT 5;

-- J2  The incident report view.
SELECT incident_id, junction, zone, approach, kind, minutes
FROM public.cw_incident_report
ORDER BY incident_id;

-- J3  Left join: every junction with its incident count, including the ones with none.
SELECT j.junction_id, j.name, count(i.incident_id) AS incidents
FROM public.junctions j
LEFT JOIN public.incidents i USING (junction_id)
GROUP BY j.junction_id, j.name
ORDER BY incidents DESC, j.junction_id
LIMIT 8;

-- J4  Right join: the same result written from the other side. Every junction survives because it
-- is the right-hand table; the junctions with no incident show an empty incident_id.
SELECT j.junction_id, j.name, i.incident_id, i.kind
FROM public.incidents i
RIGHT JOIN public.junctions j USING (junction_id)
WHERE j.junction_id IN (1, 3, 12, 25)
ORDER BY j.junction_id, i.incident_id;

-- J5  Full outer join: which junctions are heavily loaded in the morning, in the evening, both or
-- neither? "Heavily loaded" means at least 300 vehicles in a half hour in that period.
WITH am AS (
  SELECT DISTINCT junction_id FROM public.cw_slot_totals
  WHERE vehicles >= 300
    AND extract(hour FROM (recorded_at AT TIME ZONE 'UTC') + interval '5 hours 30 minutes') BETWEEN 7 AND 10
), pm AS (
  SELECT DISTINCT junction_id FROM public.cw_slot_totals
  WHERE vehicles >= 300
    AND extract(hour FROM (recorded_at AT TIME ZONE 'UTC') + interval '5 hours 30 minutes') BETWEEN 17 AND 20
)
SELECT CASE WHEN am.junction_id IS NOT NULL AND pm.junction_id IS NOT NULL THEN 'both peaks'
            WHEN am.junction_id IS NOT NULL THEN 'morning only'
            ELSE 'evening only' END AS loaded,
       count(*) AS junctions,
       min(coalesce(am.junction_id, pm.junction_id)) AS example_junction_id
FROM am
FULL OUTER JOIN pm USING (junction_id)
GROUP BY 1
ORDER BY junctions DESC;

-- J6  Self join: pairs of junctions in the same zone less than 1.5 km apart (a rough flat-earth
-- distance, good enough at this scale: 1 degree of latitude is 111 km, of longitude 108 km here).
SELECT a.name AS junction_a, b.name AS junction_b, a.zone,
       round((sqrt(power((a.latitude - b.latitude) * 111, 2) + power((a.longitude - b.longitude) * 108, 2)))::numeric, 2) AS km_apart
FROM public.junctions a
JOIN public.junctions b
  ON a.zone = b.zone
 AND a.junction_id < b.junction_id
 AND sqrt(power((a.latitude - b.latitude) * 111, 2) + power((a.longitude - b.longitude) * 108, 2)) < 1.5
ORDER BY km_apart, a.junction_id
LIMIT 8;

-- J7  Cross join: every zone against every part of the day, then joined to the readings, giving a
-- grid of the average vehicles per half hour.
SELECT z.zone, p.period, round(avg(s.vehicles), 0) AS avg_vehicles_per_half_hour
FROM (SELECT DISTINCT zone FROM public.junctions) z
CROSS JOIN (VALUES ('1 night', 0, 5), ('2 morning', 7, 10), ('3 midday', 11, 15), ('4 evening', 17, 20)) AS p(period, from_hour, to_hour)
JOIN public.junctions j ON j.zone = z.zone
JOIN public.cw_slot_totals s
  ON s.junction_id = j.junction_id
 AND extract(hour FROM (s.recorded_at AT TIME ZONE 'UTC') + interval '5 hours 30 minutes') BETWEEN p.from_hour AND p.to_hour
GROUP BY z.zone, p.period
ORDER BY z.zone, p.period;

-- J8  Four tables with a time condition in the join: did the controller give longer greens while an
-- incident was open at the junction? Decisions are matched to incidents on the same junction whose
-- window contains the decision time; the left join keeps decisions made with no incident open.
SELECT CASE WHEN i.incident_id IS NULL THEN 'no incident open' ELSE 'incident open' END AS situation,
       count(*) AS decisions,
       round(avg(sh.allocated_green_sec), 1) AS avg_green_sec,
       round(avg(sh.vehicle_count_at_decision), 1) AS avg_vehicles
FROM public.signal_history sh
JOIN public.roads r ON r.road_id = sh.road_id
JOIN public.junctions j ON j.junction_id = r.junction_id
LEFT JOIN public.incidents i
  ON i.junction_id = j.junction_id
 AND sh.decided_at BETWEEN i.starts_at AND i.ends_at
GROUP BY 1
ORDER BY 1;
