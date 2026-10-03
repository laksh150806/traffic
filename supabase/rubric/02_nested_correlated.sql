-- Rubric item 2: Nested and correlated queries (5 marks)
-- ---------------------------------------------------------------------------
-- Nested: a subquery inside a subquery, evaluated from the inside out, each part once.
-- Correlated: the inner query refers to a column of the outer row, so it is evaluated again for
-- every outer row. Q2.1 and Q2.2 are nested, Q2.3 to Q2.9 are correlated.

-- Q2.1  Three levels of nesting.
-- Innermost: the zone with the most vehicles. Middle: the average total of the junctions in that
-- zone. Outer: junctions across the network that carried more than that average.
SELECT j.junction_id, j.name, j.zone, t.total
FROM public.junctions j
JOIN (
  SELECT r.junction_id, sum(vc.vehicle_count) AS total
  FROM public.vehicle_counts vc JOIN public.roads r USING (road_id)
  GROUP BY r.junction_id
) t USING (junction_id)
WHERE t.total > (
  SELECT avg(z.total)
  FROM (
    SELECT r.junction_id, sum(vc.vehicle_count) AS total
    FROM public.vehicle_counts vc
    JOIN public.roads r USING (road_id)
    JOIN public.junctions jj USING (junction_id)
    WHERE jj.zone = (
      SELECT zz.zone
      FROM public.junctions zz
      JOIN public.roads rr USING (junction_id)
      JOIN public.vehicle_counts v2 USING (road_id)
      GROUP BY zz.zone
      ORDER BY sum(v2.vehicle_count) DESC
      LIMIT 1
    )
    GROUP BY r.junction_id
  ) z
)
ORDER BY t.total DESC, j.junction_id
LIMIT 8;

-- Q2.2  Nested IN, three deep.
-- Which approaches belong to junctions in a zone that has had an incident?
SELECT r.road_id, r.junction_id, r.direction
FROM public.roads r
WHERE r.junction_id IN (
  SELECT junction_id FROM public.junctions
  WHERE zone IN (
    SELECT zone FROM public.junctions
    WHERE junction_id IN (SELECT junction_id FROM public.incidents)
  )
)
ORDER BY r.road_id
LIMIT 8;

-- Q2.3  Correlated scalar subquery with an aggregate.
-- For each approach, how many half hours was it more than 1.5 times its own daily average?
SELECT vc.road_id, count(*) AS surge_readings
FROM public.vehicle_counts vc
WHERE vc.vehicle_count > 1.5 * (
  SELECT avg(v2.vehicle_count) FROM public.vehicle_counts v2 WHERE v2.road_id = vc.road_id
)
GROUP BY vc.road_id
ORDER BY surge_readings DESC, vc.road_id
LIMIT 8;

-- Q2.4  Correlated on the junction.
-- Which approaches are busier right now than the average approach of their own junction?
SELECT r.junction_id, r.road_id, r.direction, l.vehicle_count,
       (SELECT round(avg(l2.vehicle_count), 1)
          FROM public.roads r2 JOIN public.v_latest_vehicle_count l2 USING (road_id)
         WHERE r2.junction_id = r.junction_id) AS junction_avg
FROM public.roads r
JOIN public.v_latest_vehicle_count l USING (road_id)
WHERE l.vehicle_count > (
  SELECT avg(l2.vehicle_count)
  FROM public.roads r2 JOIN public.v_latest_vehicle_count l2 USING (road_id)
  WHERE r2.junction_id = r.junction_id
)
ORDER BY l.vehicle_count DESC, r.road_id
LIMIT 8;

-- Q2.5  Correlated EXISTS.
-- Which junctions were ever given a green of a full minute or more?
SELECT j.junction_id, j.name
FROM public.junctions j
WHERE EXISTS (
  SELECT 1 FROM public.signal_history sh
  WHERE sh.junction_id = j.junction_id AND sh.allocated_green_sec >= 60
)
ORDER BY j.junction_id
LIMIT 8;

-- Q2.6  NOT EXISTS together with EXISTS.
-- Which junctions had a very busy approach (80 or more vehicles) and yet never had an incident?
SELECT j.junction_id, j.name, j.zone
FROM public.junctions j
WHERE EXISTS (
        SELECT 1
        FROM public.roads r JOIN public.vehicle_counts vc USING (road_id)
        WHERE r.junction_id = j.junction_id AND vc.vehicle_count >= 80
      )
  AND NOT EXISTS (SELECT 1 FROM public.incidents i WHERE i.junction_id = j.junction_id)
ORDER BY j.junction_id
LIMIT 8;

-- Q2.7  Correlated subqueries in the SELECT list.
-- For each junction: how many incidents, and when was it last given a phase change?
SELECT j.junction_id, j.name,
       (SELECT count(*) FROM public.incidents i WHERE i.junction_id = j.junction_id) AS incidents,
       (SELECT max(p.started_at) FROM public.phase_log p WHERE p.junction_id = j.junction_id) AS last_phase_utc
FROM public.junctions j
ORDER BY incidents DESC, j.junction_id
LIMIT 8;

-- Q2.8  Correlated count used as a rank.
-- The two busiest junctions in every zone: a junction qualifies when fewer than two others in its
-- own zone carried more vehicles.
WITH totals AS (
  SELECT j.junction_id, j.name, j.zone, sum(vc.vehicle_count) AS total
  FROM public.vehicle_counts vc
  JOIN public.roads r USING (road_id)
  JOIN public.junctions j USING (junction_id)
  GROUP BY j.junction_id, j.name, j.zone
)
SELECT t.zone, t.name, t.total
FROM totals t
WHERE (SELECT count(*) FROM totals t2 WHERE t2.zone = t.zone AND t2.total > t.total) < 2
ORDER BY t.zone, t.total DESC;

-- Q2.9  ALL with a subquery.
-- Which junctions had a busiest half hour at least as busy as every junction in the GST Corridor?
WITH peak AS (
  SELECT s.junction_id, max(s.total) AS peak_vehicles
  FROM (
    SELECT r.junction_id, vc.recorded_at, sum(vc.vehicle_count) AS total
    FROM public.vehicle_counts vc JOIN public.roads r USING (road_id)
    GROUP BY r.junction_id, vc.recorded_at
  ) s
  GROUP BY s.junction_id
)
SELECT j.junction_id, j.name, j.zone, p.peak_vehicles
FROM public.junctions j
JOIN peak p USING (junction_id)
WHERE p.peak_vehicles >= ALL (
  SELECT p2.peak_vehicles
  FROM peak p2 JOIN public.junctions j2 USING (junction_id)
  WHERE j2.zone = 'GST Corridor'
)
ORDER BY p.peak_vehicles DESC, j.junction_id
LIMIT 8;
