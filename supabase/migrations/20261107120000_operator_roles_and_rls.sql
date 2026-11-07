-- Operator accounts, roles and row-level security.
--
-- Every account gets one row in operator_profiles with one of three roles:
--   admin    : everything an operator can do, plus changing roles and deleting records
--   operator : report and end incidents, hold a signal green, log an ambulance dispatch
--   viewer   : read only
-- The rules are row-level security policies and column grants, so they hold for anyone calling
-- the API directly, not only for the page. The very first account becomes the admin; every later
-- one starts as a viewer until an admin promotes it.
-- Safe to run twice.

-- ---------------------------------------------------------------------------
-- 1. Profiles and the role helpers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operator_profiles (
  user_id      uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 60),
  role         text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'operator', 'viewer')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operator_profiles_role_idx ON public.operator_profiles (role);

-- The caller's role, or 'none' when signed out. SECURITY DEFINER so policies can call it
-- without recursing into the profiles table's own policies.
CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT role FROM public.operator_profiles WHERE user_id = auth.uid()), 'none')
$$;

CREATE OR REPLACE FUNCTION public.can_operate()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.app_role() IN ('admin', 'operator')
$$;

REVOKE ALL ON FUNCTION public.app_role() FROM public;
REVOKE ALL ON FUNCTION public.can_operate() FROM public;
GRANT EXECUTE ON FUNCTION public.app_role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_operate() TO anon, authenticated, service_role;

-- A new sign-up gets a profile straight away: admin if it is the first, viewer otherwise.
CREATE OR REPLACE FUNCTION public.handle_new_operator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.operator_profiles (user_id, display_name, role)
  VALUES (
    NEW.id,
    left(
      coalesce(
        nullif(btrim(NEW.raw_user_meta_data ->> 'display_name'), ''),
        split_part(coalesce(NEW.email, 'operator'), '@', 1)
      ),
      60
    ),
    CASE WHEN EXISTS (SELECT 1 FROM public.operator_profiles) THEN 'viewer' ELSE 'admin' END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_new_operator ON auth.users;
CREATE TRIGGER trg_new_operator
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_operator();

-- Accounts made before this migration get a profile too, oldest first, so the oldest is admin.
INSERT INTO public.operator_profiles (user_id, display_name, role)
SELECT u.id,
       left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
                     split_part(coalesce(u.email, 'operator'), '@', 1)), 60),
       CASE WHEN row_number() OVER (ORDER BY u.created_at) = 1
                 AND NOT EXISTS (SELECT 1 FROM public.operator_profiles) THEN 'admin'
            ELSE 'viewer' END
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

-- The control room can never be left without an admin.
CREATE OR REPLACE FUNCTION public.keep_one_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'admin'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'admin')
     AND NOT EXISTS (
       SELECT 1 FROM public.operator_profiles WHERE role = 'admin' AND user_id <> OLD.user_id
     ) THEN
    RAISE EXCEPTION 'At least one admin must remain' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

DROP TRIGGER IF EXISTS trg_keep_one_admin ON public.operator_profiles;
CREATE TRIGGER trg_keep_one_admin
  BEFORE UPDATE OF role OR DELETE ON public.operator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.keep_one_admin();

ALTER TABLE public.operator_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.operator_profiles TO authenticated;
-- People may rename themselves; only the set_operator_role function changes a role.
GRANT UPDATE (display_name) ON public.operator_profiles TO authenticated;
GRANT ALL ON public.operator_profiles TO service_role;
DROP POLICY IF EXISTS "profiles_crew_read" ON public.operator_profiles;
CREATE POLICY "profiles_crew_read" ON public.operator_profiles
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "profiles_self_rename" ON public.operator_profiles;
CREATE POLICY "profiles_self_rename" ON public.operator_profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. The operator log: every write below leaves a line here
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operator_actions (
  action_id   bigserial PRIMARY KEY,
  actor       uuid REFERENCES public.operator_profiles (user_id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action IN (
                'INCIDENT_REPORTED', 'INCIDENT_ENDED', 'INCIDENT_DELETED',
                'SIGNAL_HELD', 'SIGNAL_RELEASED', 'AMBULANCE_DISPATCHED', 'ROLE_CHANGED')),
  junction_id integer REFERENCES public.junctions (junction_id) ON DELETE SET NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operator_actions_at_idx ON public.operator_actions (at DESC);
ALTER TABLE public.operator_actions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.operator_actions TO authenticated;
GRANT ALL ON public.operator_actions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.operator_actions_action_id_seq TO service_role;
DROP POLICY IF EXISTS "actions_crew_read" ON public.operator_actions;
CREATE POLICY "actions_crew_read" ON public.operator_actions
  FOR SELECT TO authenticated USING (true);
-- No insert policy: lines are written only by the SECURITY DEFINER triggers and functions below.

-- ---------------------------------------------------------------------------
-- 3. Incidents: operators may report and end them, admins may delete them
-- ---------------------------------------------------------------------------
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS severity smallint NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 3);
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS reported_by uuid DEFAULT auth.uid()
  REFERENCES public.operator_profiles (user_id) ON DELETE SET NULL;
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS ended_by uuid
  REFERENCES public.operator_profiles (user_id) ON DELETE SET NULL;

GRANT INSERT (junction_id, road_id, kind, note, severity, starts_at, ends_at)
  ON public.incidents TO authenticated;
GRANT UPDATE (ends_at, note, ended_by) ON public.incidents TO authenticated;
GRANT DELETE ON public.incidents TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.incidents_incident_id_seq TO authenticated;

DROP POLICY IF EXISTS "incidents_operator_insert" ON public.incidents;
CREATE POLICY "incidents_operator_insert" ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_operate()
    AND reported_by = auth.uid()
    AND ends_at <= starts_at + interval '24 hours'
  );
DROP POLICY IF EXISTS "incidents_operator_update" ON public.incidents;
CREATE POLICY "incidents_operator_update" ON public.incidents
  FOR UPDATE TO authenticated
  USING (public.can_operate())
  WITH CHECK (public.can_operate());
DROP POLICY IF EXISTS "incidents_admin_delete" ON public.incidents;
CREATE POLICY "incidents_admin_delete" ON public.incidents
  FOR DELETE TO authenticated
  USING (public.app_role() = 'admin');

CREATE OR REPLACE FUNCTION public.log_incident_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD); -- the server's own control loop is not an operator action
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.operator_actions (actor, action, junction_id, detail)
    VALUES (auth.uid(), 'INCIDENT_REPORTED', NEW.junction_id,
            jsonb_build_object('incident_id', NEW.incident_id, 'road_id', NEW.road_id,
                               'kind', NEW.kind, 'severity', NEW.severity, 'ends_at', NEW.ends_at));
  ELSIF TG_OP = 'UPDATE' AND NEW.ends_at < OLD.ends_at AND NEW.ends_at <= now() THEN
    INSERT INTO public.operator_actions (actor, action, junction_id, detail)
    VALUES (auth.uid(), 'INCIDENT_ENDED', NEW.junction_id,
            jsonb_build_object('incident_id', NEW.incident_id, 'kind', NEW.kind));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.operator_actions (actor, action, junction_id, detail)
    VALUES (auth.uid(), 'INCIDENT_DELETED', OLD.junction_id,
            jsonb_build_object('incident_id', OLD.incident_id, 'kind', OLD.kind));
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS trg_log_incident ON public.incidents;
CREATE TRIGGER trg_log_incident
  AFTER INSERT OR UPDATE OR DELETE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.log_incident_change();

-- ---------------------------------------------------------------------------
-- 4. Signal holds: an operator keeps one approach green for up to 15 minutes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signal_holds (
  hold_id     bigserial PRIMARY KEY,
  junction_id integer NOT NULL REFERENCES public.junctions (junction_id) ON DELETE CASCADE,
  road_id     integer NOT NULL,
  reason      text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 200),
  held_by     uuid DEFAULT auth.uid() REFERENCES public.operator_profiles (user_id) ON DELETE SET NULL,
  released_by uuid REFERENCES public.operator_profiles (user_id) ON DELETE SET NULL,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL,
  CONSTRAINT signal_holds_window_chk
    CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '15 minutes'),
  CONSTRAINT signal_holds_road_junction_fk FOREIGN KEY (road_id, junction_id)
    REFERENCES public.roads (road_id, junction_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS signal_holds_active_idx ON public.signal_holds (junction_id, ends_at);

-- Only one live hold per junction: two would ask for two greens at once.
CREATE OR REPLACE FUNCTION public.one_hold_per_junction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.signal_holds
    WHERE junction_id = NEW.junction_id AND ends_at > now() AND hold_id <> NEW.hold_id
  ) THEN
    RAISE EXCEPTION 'Junction % already has a signal held', NEW.junction_id
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_one_hold_per_junction ON public.signal_holds;
CREATE TRIGGER trg_one_hold_per_junction
  BEFORE INSERT ON public.signal_holds
  FOR EACH ROW EXECUTE FUNCTION public.one_hold_per_junction();

CREATE OR REPLACE FUNCTION public.log_hold_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.operator_actions (actor, action, junction_id, detail)
    VALUES (auth.uid(), 'SIGNAL_HELD', NEW.junction_id,
            jsonb_build_object('hold_id', NEW.hold_id, 'road_id', NEW.road_id,
                               'reason', NEW.reason, 'ends_at', NEW.ends_at));
  ELSIF NEW.ends_at < OLD.ends_at THEN
    INSERT INTO public.operator_actions (actor, action, junction_id, detail)
    VALUES (auth.uid(), 'SIGNAL_RELEASED', NEW.junction_id,
            jsonb_build_object('hold_id', NEW.hold_id, 'road_id', NEW.road_id));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_log_hold ON public.signal_holds;
CREATE TRIGGER trg_log_hold
  AFTER INSERT OR UPDATE ON public.signal_holds
  FOR EACH ROW EXECUTE FUNCTION public.log_hold_change();

ALTER TABLE public.signal_holds ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.signal_holds TO anon, authenticated;
GRANT INSERT (junction_id, road_id, reason, ends_at) ON public.signal_holds TO authenticated;
GRANT UPDATE (ends_at, released_by) ON public.signal_holds TO authenticated;
GRANT DELETE ON public.signal_holds TO authenticated;
GRANT ALL ON public.signal_holds TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.signal_holds_hold_id_seq TO authenticated, service_role;

DROP POLICY IF EXISTS "holds_public_read" ON public.signal_holds;
CREATE POLICY "holds_public_read" ON public.signal_holds
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "holds_operator_insert" ON public.signal_holds;
CREATE POLICY "holds_operator_insert" ON public.signal_holds
  FOR INSERT TO authenticated
  WITH CHECK (public.can_operate() AND held_by = auth.uid());
DROP POLICY IF EXISTS "holds_operator_release" ON public.signal_holds;
CREATE POLICY "holds_operator_release" ON public.signal_holds
  FOR UPDATE TO authenticated
  USING (public.can_operate())
  WITH CHECK (public.can_operate());
DROP POLICY IF EXISTS "holds_admin_delete" ON public.signal_holds;
CREATE POLICY "holds_admin_delete" ON public.signal_holds
  FOR DELETE TO authenticated
  USING (public.app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 5. Functions the page calls for the two actions that are not a plain row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_operator_role(p_user uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_role text;
BEGIN
  IF public.app_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin can change roles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_role NOT IN ('admin', 'operator', 'viewer') THEN
    RAISE EXCEPTION 'Unknown role %', p_role USING ERRCODE = 'check_violation';
  END IF;
  SELECT role INTO old_role FROM public.operator_profiles WHERE user_id = p_user FOR UPDATE;
  IF old_role IS NULL THEN
    RAISE EXCEPTION 'No such operator' USING ERRCODE = 'no_data_found';
  END IF;
  IF old_role = p_role THEN
    RETURN;
  END IF;
  UPDATE public.operator_profiles SET role = p_role WHERE user_id = p_user;
  INSERT INTO public.operator_actions (actor, action, detail)
  VALUES (auth.uid(), 'ROLE_CHANGED',
          jsonb_build_object('user_id', p_user, 'from', old_role, 'to', p_role));
END
$$;

CREATE OR REPLACE FUNCTION public.log_dispatch(p_junction integer, p_hospital text, p_stops integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id bigint;
BEGIN
  IF NOT public.can_operate() THEN
    RAISE EXCEPTION 'Only an operator can dispatch' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.operator_actions (actor, action, junction_id, detail)
  VALUES (auth.uid(), 'AMBULANCE_DISPATCHED', p_junction,
          jsonb_build_object('hospital', left(p_hospital, 80), 'stops', p_stops))
  RETURNING action_id INTO new_id;
  RETURN new_id;
END
$$;

REVOKE ALL ON FUNCTION public.set_operator_role(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.log_dispatch(integer, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.set_operator_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_dispatch(integer, text, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.handle_new_operator() FROM public;
REVOKE ALL ON FUNCTION public.keep_one_admin() FROM public;
REVOKE ALL ON FUNCTION public.log_incident_change() FROM public;
REVOKE ALL ON FUNCTION public.log_hold_change() FROM public;

-- ---------------------------------------------------------------------------
-- 6. Views the operations page reads
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_operator_log;
CREATE VIEW public.v_operator_log WITH (security_invoker = on) AS
SELECT a.action_id,
       a.at,
       a.action,
       a.junction_id,
       j.name AS junction_name,
       coalesce(p.display_name, 'system') AS actor_name,
       p.role AS actor_role,
       a.detail
FROM public.operator_actions a
LEFT JOIN public.operator_profiles p ON p.user_id = a.actor
LEFT JOIN public.junctions j ON j.junction_id = a.junction_id;
GRANT SELECT ON public.v_operator_log TO authenticated;

DROP VIEW IF EXISTS public.v_incident_board;
CREATE VIEW public.v_incident_board WITH (security_invoker = on) AS
SELECT i.incident_id,
       i.junction_id,
       j.name AS junction_name,
       j.zone,
       i.road_id,
       r.direction,
       i.kind,
       i.severity,
       i.note,
       i.starts_at,
       i.ends_at,
       i.ends_at > now() AS active,
       rp.display_name AS reported_by_name,
       ep.display_name AS ended_by_name
FROM public.incidents i
JOIN public.junctions j ON j.junction_id = i.junction_id
JOIN public.roads r ON r.road_id = i.road_id
LEFT JOIN public.operator_profiles rp ON rp.user_id = i.reported_by
LEFT JOIN public.operator_profiles ep ON ep.user_id = i.ended_by;
GRANT SELECT ON public.v_incident_board TO authenticated;
