-- Removes everything the coursework scripts add: the sample day, the cw_ views, tables, functions,
-- procedures and triggers. The application's own tables, views and functions are not touched.

DROP TRIGGER IF EXISTS cw_trg_forward_intake ON public.cw_sensor_intake;
DROP TRIGGER IF EXISTS cw_trg_check_intake ON public.cw_sensor_intake;
DROP FUNCTION IF EXISTS public.cw_forward_intake();
DROP FUNCTION IF EXISTS public.cw_check_intake();
DROP FUNCTION IF EXISTS public.cw_try_submit(integer, integer);
DROP FUNCTION IF EXISTS public.cw_open_busiest(text, refcursor);
DROP FUNCTION IF EXISTS public.cw_grade(integer, integer);
DROP PROCEDURE IF EXISTS public.cw_build_daily_report(date, text, integer);
DROP PROCEDURE IF EXISTS public.cw_resolve_incident(bigint, integer, timestamptz);

DROP TABLE IF EXISTS public.cw_daily_report;
DROP TABLE IF EXISTS public.cw_alert;
DROP TABLE IF EXISTS public.cw_sensor_intake;

DROP VIEW IF EXISTS public.cw_incident_report;
DROP VIEW IF EXISTS public.cw_adaptive_vs_fixed;
DROP VIEW IF EXISTS public.cw_junction_peak;
DROP VIEW IF EXISTS public.cw_slot_totals;

DELETE FROM public.vehicle_counts WHERE source = 'MANUAL';
DELETE FROM public.vehicle_counts
 WHERE recorded_at >= timestamptz '2026-10-01 00:00+05:30' AND recorded_at < timestamptz '2026-10-02 00:00+05:30';
DELETE FROM public.signal_history
 WHERE decided_at >= timestamptz '2026-10-01 00:00+05:30' AND decided_at < timestamptz '2026-10-02 00:00+05:30';
DELETE FROM public.phase_log
 WHERE started_at >= timestamptz '2026-10-01 00:00+05:30' AND started_at < timestamptz '2026-10-02 00:00+05:30';
DELETE FROM public.incidents
 WHERE starts_at >= timestamptz '2026-10-01 00:00+05:30' AND starts_at < timestamptz '2026-10-02 00:00+05:30';
