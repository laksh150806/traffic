-- Optional: let Supabase itself call the app on a schedule, so the live loop runs with no browser
-- open and no worker of your own. Not part of the migrations because it needs your deployed URL
-- and your secret. Run it in the SQL editor once the app is deployed somewhere Supabase can reach
-- (a public URL, not localhost).
--
-- 1. Choose a secret of 16 or more characters and set it on the app as CONTROL_CRON_SECRET.
-- 2. Replace YOUR-APP-URL and YOUR-SECRET below.
-- 3. Set CONTROL_BROWSER_DRIVEN=false on the app so the open browser endpoints stop doing anything.
--
-- The secret is stored in the cron job's command, readable by anyone with database admin access.
-- That is fine for a project you own; for anything shared, keep it in Supabase Vault instead.
-- Needs pg_cron 1.5 or later for schedules in seconds, which Supabase provides.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'traffic-advance',
  '2 seconds',
  $$SELECT net.http_post(
      url := 'https://YOUR-APP-URL/api/control?loop=advance',
      headers := jsonb_build_object('Authorization', 'Bearer YOUR-SECRET'),
      timeout_milliseconds := 5000
    )$$
);

SELECT cron.schedule(
  'traffic-tick',
  '12 seconds',
  $$SELECT net.http_post(
      url := 'https://YOUR-APP-URL/api/control?loop=tick',
      headers := jsonb_build_object('Authorization', 'Bearer YOUR-SECRET'),
      timeout_milliseconds := 10000
    )$$
);

-- To stop:
--   SELECT cron.unschedule('traffic-advance');
--   SELECT cron.unschedule('traffic-tick');
