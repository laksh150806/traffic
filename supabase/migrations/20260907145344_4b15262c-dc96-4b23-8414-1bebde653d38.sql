ALTER TABLE public.signal_history
  ADD COLUMN IF NOT EXISTS arrival_rate_vph numeric,
  ADD COLUMN IF NOT EXISTS saturation_flow_vph numeric,
  ADD COLUMN IF NOT EXISTS degree_saturation numeric,
  ADD COLUMN IF NOT EXISTS predicted_delay_adaptive_sec numeric,
  ADD COLUMN IF NOT EXISTS predicted_delay_fixed_sec numeric,
  ADD COLUMN IF NOT EXISTS predicted_queue_next integer,
  ADD COLUMN IF NOT EXISTS cycle_length_sec integer;

CREATE TABLE public.model_road_state (
  road_id integer PRIMARY KEY REFERENCES public.roads(road_id) ON DELETE CASCADE,
  junction_id integer NOT NULL REFERENCES public.junctions(junction_id) ON DELETE CASCADE,
  arrival_rate_vph numeric NOT NULL DEFAULT 0,
  saturation_flow_vph numeric NOT NULL DEFAULT 1800,
  flow_ratio numeric NOT NULL DEFAULT 0,
  degree_saturation numeric NOT NULL DEFAULT 0,
  green_sec integer NOT NULL DEFAULT 30,
  cycle_length_sec integer NOT NULL DEFAULT 120,
  queue_now integer NOT NULL DEFAULT 0,
  predicted_queue_next integer NOT NULL DEFAULT 0,
  predicted_delay_adaptive_sec numeric NOT NULL DEFAULT 0,
  predicted_delay_fixed_sec numeric NOT NULL DEFAULT 0,
  queue_clears boolean NOT NULL DEFAULT true,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.model_road_state TO anon;
GRANT SELECT ON public.model_road_state TO authenticated;
GRANT ALL ON public.model_road_state TO service_role;
ALTER TABLE public.model_road_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model_state_public_read" ON public.model_road_state FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.model_accuracy (
  accuracy_id bigserial PRIMARY KEY,
  road_id integer NOT NULL REFERENCES public.roads(road_id) ON DELETE CASCADE,
  junction_id integer NOT NULL REFERENCES public.junctions(junction_id) ON DELETE CASCADE,
  predicted_queue integer NOT NULL,
  actual_queue integer NOT NULL,
  abs_error numeric NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.model_accuracy TO anon;
GRANT SELECT ON public.model_accuracy TO authenticated;
GRANT ALL ON public.model_accuracy TO service_role;
ALTER TABLE public.model_accuracy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model_accuracy_public_read" ON public.model_accuracy FOR SELECT TO anon, authenticated USING (true);

CREATE INDEX idx_model_accuracy_recorded_at ON public.model_accuracy(recorded_at DESC);
CREATE INDEX idx_model_road_state_junction ON public.model_road_state(junction_id);