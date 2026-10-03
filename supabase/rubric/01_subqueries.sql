-- Rubric item 1: Subqueries (5 marks)
-- ---------------------------------------------------------------------------
-- A subquery is a SELECT inside another statement. The seven below use it in every place the
-- language allows: WHERE with a scalar value, IN and NOT IN, the SELECT list, FROM (a derived
-- table), a row-wise comparison and HAVING. Data: 00_sample_data.sql (one day, 30-minute slots).

-- Q1.1  Scalar subquery in WHERE.
-- Which approaches can hold more vehicles than the average approach in the network?
SELECT road_id, junction_id, road_name, max_capacity
FROM public.roads
WHERE max_capacity > (SELECT avg(max_capacity) FROM public.roads)
ORDER BY max_capacity DESC, road_id
LIMIT 8;

-- Q1.2  IN with a subquery.
-- Which junctions had at least one incident?
SELECT junction_id, name, zone
FROM public.junctions
WHERE junction_id IN (SELECT junction_id FROM public.incidents)
ORDER BY junction_id;

-- Q1.3  NOT IN with a subquery.
-- How many junctions had no incident at all? (junction_id is never NULL, so NOT IN is safe here.)
SELECT count(*) AS junctions_without_incident
FROM public.junctions
WHERE junction_id NOT IN (SELECT junction_id FROM public.incidents);

-- Q1.4  Scalar subquery in the SELECT list.
-- What share of all counted vehicles does each zone carry?
SELECT j.zone,
       sum(vc.vehicle_count) AS vehicles,
       round(100.0 * sum(vc.vehicle_count) / (SELECT sum(vehicle_count) FROM public.vehicle_counts), 1) AS pct_of_network
FROM public.vehicle_counts vc
JOIN public.roads r USING (road_id)
JOIN public.junctions j USING (junction_id)
GROUP BY j.zone
ORDER BY vehicles DESC;

-- Q1.5  Subquery in FROM (derived tables, two levels).
-- When was each junction at its busiest half hour, and how many vehicles arrived in it?
SELECT j.name, j.zone, peak.peak_vehicles,
       to_char((peak.peak_at AT TIME ZONE 'UTC') + interval '5 hours 30 minutes', 'HH24:MI') AS peak_time_ist
FROM public.junctions j
JOIN (
  SELECT DISTINCT ON (slot.junction_id)
         slot.junction_id, slot.total AS peak_vehicles, slot.recorded_at AS peak_at
  FROM (
    SELECT r.junction_id, vc.recorded_at, sum(vc.vehicle_count) AS total
    FROM public.vehicle_counts vc
    JOIN public.roads r USING (road_id)
    GROUP BY r.junction_id, vc.recorded_at
  ) slot
  ORDER BY slot.junction_id, slot.total DESC, slot.recorded_at
) peak USING (junction_id)
ORDER BY peak.peak_vehicles DESC, j.junction_id
LIMIT 8;

-- Q1.6  Row-wise IN: a pair of columns compared with the pairs a subquery returns.
-- What did the controller decide at each junction's last decision time?
SELECT sh.junction_id, sh.road_id, sh.allocated_green_sec, sh.vehicle_count_at_decision
FROM public.signal_history sh
WHERE (sh.junction_id, sh.decided_at) IN (
  SELECT junction_id, max(decided_at) FROM public.signal_history GROUP BY junction_id
)
ORDER BY sh.junction_id, sh.allocated_green_sec DESC
LIMIT 8;

-- Q1.7  Subquery in HAVING.
-- Which zones had an average reading above the network-wide average?
SELECT j.zone, round(avg(vc.vehicle_count), 1) AS zone_avg
FROM public.vehicle_counts vc
JOIN public.roads r USING (road_id)
JOIN public.junctions j USING (junction_id)
GROUP BY j.zone
HAVING avg(vc.vehicle_count) > (SELECT avg(vehicle_count) FROM public.vehicle_counts)
ORDER BY zone_avg DESC;
