ALTER TABLE public.model_road_state
  ADD COLUMN IF NOT EXISTS queue_exact numeric NOT NULL DEFAULT 0;