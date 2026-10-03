DROP VIEW IF EXISTS public.v_junction_congestion;

CREATE VIEW public.v_junction_congestion AS
WITH latest AS (
  SELECT DISTINCT ON (vc.road_id) vc.road_id, vc.vehicle_count, vc.recorded_at
  FROM public.vehicle_counts vc
  ORDER BY vc.road_id, vc.recorded_at DESC
), model AS (
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
         WHEN COALESCE(max(mo.avg_saturation), 0) >= 0.95 THEN 'HIGH'::text
         WHEN COALESCE(max(mo.avg_saturation), 0) >= 0.75 THEN 'MODERATE'::text
         ELSE 'LOW'::text
       END AS congestion_level,
       max(l.recorded_at) AS last_reading_at
FROM public.junctions j
LEFT JOIN public.roads r ON r.junction_id = j.junction_id
LEFT JOIN latest l ON l.road_id = r.road_id
LEFT JOIN model mo ON mo.junction_id = j.junction_id
GROUP BY j.junction_id, j.name, j.zone, j.latitude, j.longitude;

GRANT SELECT ON public.v_junction_congestion TO anon;
GRANT SELECT ON public.v_junction_congestion TO authenticated;
GRANT SELECT ON public.v_junction_congestion TO service_role;