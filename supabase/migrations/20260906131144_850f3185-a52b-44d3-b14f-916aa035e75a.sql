ALTER TABLE public.junctions ADD COLUMN IF NOT EXISTS zone character varying NOT NULL DEFAULT 'Central';

UPDATE public.junctions SET zone = 'GST Corridor' WHERE junction_id BETWEEN 1 AND 5;

INSERT INTO public.junctions (name, latitude, longitude, zone) VALUES
  ('Gemini Flyover (Anna Salai)', 13.0450000, 80.2480000, 'Central'),
  ('Teynampet Signal', 13.0390000, 80.2490000, 'Central'),
  ('Nandanam Signal', 13.0300000, 80.2410000, 'Central'),
  ('Saidapet Bridge Junction', 13.0220000, 80.2230000, 'Central'),
  ('Guindy Signal', 13.0100000, 80.2200000, 'Central'),
  ('Kathipara Junction', 13.0080000, 80.2010000, 'Central'),
  ('Alandur Signal', 13.0030000, 80.2030000, 'Central'),
  ('Little Mount Junction', 13.0140000, 80.2180000, 'Central'),
  ('Egmore Station Junction', 13.0790000, 80.2610000, 'Central'),
  ('Chetpet Signal', 13.0720000, 80.2430000, 'Central'),
  ('Choolaimedu Signal', 13.0600000, 80.2260000, 'Central'),
  ('Vadapalani Signal', 13.0500000, 80.2110000, 'Central'),
  ('Ashok Pillar Junction', 13.0240000, 80.2110000, 'Central'),
  ('Kodambakkam Bridge Junction', 13.0510000, 80.2240000, 'Central'),
  ('Nungambakkam High Road Signal', 13.0570000, 80.2420000, 'Central'),
  ('Royapettah Signal', 13.0540000, 80.2660000, 'Central'),
  ('Mount Road LIC Junction', 13.0640000, 80.2620000, 'Central'),
  ('Broadway Junction', 13.0930000, 80.2870000, 'North'),
  ('Chennai Central Junction', 13.0820000, 80.2750000, 'North'),
  ('Parrys Corner Signal', 13.0940000, 80.2900000, 'North'),
  ('Basin Bridge Junction', 13.1030000, 80.2720000, 'North'),
  ('Vyasarpadi Signal', 13.1180000, 80.2600000, 'North'),
  ('Tondiarpet Signal', 13.1290000, 80.2870000, 'North'),
  ('Washermanpet Junction', 13.1150000, 80.2860000, 'North'),
  ('Perambur Signal', 13.1180000, 80.2330000, 'North'),
  ('Villivakkam Junction', 13.1030000, 80.2100000, 'North'),
  ('Ambattur Estate Junction', 13.1110000, 80.1620000, 'North'),
  ('Padi Flyover Junction', 13.1000000, 80.1830000, 'North'),
  ('Thiruvottiyur Signal', 13.1600000, 80.3020000, 'North'),
  ('Manali New Town Junction', 13.1670000, 80.2600000, 'North'),
  ('Ennore Junction', 13.2200000, 80.3200000, 'North'),
  ('Red Hills Junction', 13.1900000, 80.1800000, 'North'),
  ('Adyar Signal', 13.0060000, 80.2560000, 'South'),
  ('Madhya Kailash Junction', 13.0080000, 80.2480000, 'South'),
  ('Tidel Park Signal', 12.9880000, 80.2480000, 'South'),
  ('Thiruvanmiyur Signal', 12.9830000, 80.2590000, 'South'),
  ('Perungudi Toll Junction', 12.9640000, 80.2460000, 'South'),
  ('Sholinganallur Junction', 12.9010000, 80.2270000, 'South'),
  ('Navalur Signal', 12.8450000, 80.2270000, 'South'),
  ('Siruseri Signal', 12.8230000, 80.2200000, 'South'),
  ('Velachery Signal', 12.9800000, 80.2210000, 'South'),
  ('Medavakkam Junction', 12.9200000, 80.1930000, 'South'),
  ('Pallikaranai Signal', 12.9330000, 80.2100000, 'South'),
  ('Thoraipakkam Junction', 12.9400000, 80.2340000, 'South'),
  ('Besant Nagar Signal', 12.9990000, 80.2660000, 'South'),
  ('Saidapet Kotturpuram Signal', 13.0170000, 80.2450000, 'South'),
  ('Koyambedu Junction', 13.0700000, 80.1950000, 'West'),
  ('Maduravoyal Junction', 13.0650000, 80.1600000, 'West'),
  ('Porur Junction', 13.0350000, 80.1560000, 'West'),
  ('Valasaravakkam Signal', 13.0430000, 80.1740000, 'West'),
  ('Alwarthirunagar Signal', 13.0490000, 80.1830000, 'West'),
  ('Virugambakkam Signal', 13.0560000, 80.1930000, 'West'),
  ('Poonamallee Bypass Junction', 13.0480000, 80.0960000, 'West'),
  ('Nerkundram Signal', 13.0620000, 80.1810000, 'West'),
  ('Mount Poonamallee Road Signal', 13.0270000, 80.1470000, 'West'),
  ('Iyyappanthangal Junction', 13.0270000, 80.1150000, 'West'),
  ('Tambaram Sanatorium Signal', 12.9330000, 80.1180000, 'Outer'),
  ('Chromepet Signal', 12.9510000, 80.1400000, 'Outer'),
  ('Pallavaram Signal', 12.9670000, 80.1500000, 'Outer'),
  ('Avadi Junction', 13.1150000, 80.1000000, 'Outer'),
  ('Thiruninravur Junction', 13.1180000, 80.0300000, 'Outer'),
  ('Perungalathur Signal', 12.9070000, 80.0930000, 'Outer'),
  ('Kelambakkam Junction', 12.7900000, 80.2200000, 'Outer'),
  ('Minjur Signal', 13.2700000, 80.2600000, 'Outer');

INSERT INTO public.roads (junction_id, direction, road_name, max_capacity)
SELECT j.junction_id,
       d.direction,
       j.name || ' - ' || initcap(lower(d.direction)) || ' Approach',
       CASE WHEN j.zone IN ('Central','North') THEN 140 WHEN j.zone = 'Outer' THEN 100 ELSE 120 END
FROM public.junctions j
CROSS JOIN (VALUES ('NORTH'),('SOUTH'),('EAST'),('WEST')) AS d(direction)
WHERE NOT EXISTS (SELECT 1 FROM public.roads r WHERE r.junction_id = j.junction_id);

INSERT INTO public.cctv_cameras (road_id, camera_name)
SELECT r.road_id, 'CAM-' || lpad(r.road_id::text, 3, '0') || ' ' || r.direction
FROM public.roads r
WHERE NOT EXISTS (SELECT 1 FROM public.cctv_cameras c WHERE c.road_id = r.road_id);

INSERT INTO public.signal_timings (junction_id, road_id, timing_mode, green_duration_sec, is_currently_green)
SELECT r.junction_id, r.road_id, 'ADAPTIVE', 30, r.direction = 'NORTH'
FROM public.roads r
WHERE NOT EXISTS (SELECT 1 FROM public.signal_timings t WHERE t.road_id = r.road_id);

INSERT INTO public.vehicle_counts (road_id, vehicle_count, source)
SELECT r.road_id, 20 + (abs(hashtext(r.road_id::text || r.direction)) % 55), 'SIMULATED_SENSOR'
FROM public.roads r
WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_counts vc WHERE vc.road_id = r.road_id);

INSERT INTO public.signal_history (junction_id, road_id, vehicle_count_at_decision, allocated_green_sec, baseline_fixed_sec, estimated_wait_saved_sec, cycle_number)
SELECT r.junction_id,
       r.road_id,
       vc.vehicle_count,
       greatest(15, least(90, 15 + (vc.vehicle_count * 3) / 4)),
       30,
       greatest(0, (vc.vehicle_count / 4)),
       1
FROM public.roads r
JOIN (
  SELECT DISTINCT ON (road_id) road_id, vehicle_count FROM public.vehicle_counts ORDER BY road_id, recorded_at DESC
) vc ON vc.road_id = r.road_id
WHERE NOT EXISTS (SELECT 1 FROM public.signal_history sh WHERE sh.road_id = r.road_id);

DROP VIEW IF EXISTS public.v_junction_congestion;
CREATE VIEW public.v_junction_congestion WITH (security_invoker = on) AS
WITH latest AS (
  SELECT DISTINCT ON (vc.road_id) vc.road_id, vc.vehicle_count, vc.recorded_at
  FROM public.vehicle_counts vc
  ORDER BY vc.road_id, vc.recorded_at DESC
)
SELECT j.junction_id,
       j.name,
       j.zone,
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
GROUP BY j.junction_id, j.name, j.zone, j.latitude, j.longitude;
GRANT SELECT ON public.v_junction_congestion TO anon, authenticated;