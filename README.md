# Smart Traffic Management

Adaptive signal control for 69 Chennai junctions. A queue model sets green times from
how many vehicles are waiting, and the dashboard compares the predicted wait against a
fixed timer.

It works like a maps app for a traffic control room:

- **Explore.** A map of all 69 junctions coloured by congestion, a ranked "needs attention"
  list, and search. Select a junction for its wait times, a typical-day chart and the live
  signal.
- **Time bar.** Drag it to see the whole network at any hour in the next 24 hours, or jump
  to the morning or evening peak. Ahead of now, the map shows the model's forecast.
- **Directions.** Pick two junctions (or drop pins) and get routes with the delay at the
  modelled junctions on the way counted, each priced for the time the vehicle should reach
  it, the fastest route first, and how much the adaptive timing saves against fixed timers.
  Roads and base drive time come from OSRM's public demo server; if it cannot be reached
  the page says so and falls back to a straight-line estimate.
- **Inspector.** The queue model's numbers for the selected junction, with a 3D junction view
  of queued vehicles and the signal heads.

## Run it

Requirements: Node.js 22 and npm.

```sh
npm install
npm run dev
```

Open the address Vite prints. It works straight away with no backend: by default the
app runs in **demo mode** and simulates the whole network in the browser.

Other scripts:

| Script                | What it does                                                           |
| --------------------- | ---------------------------------------------------------------------- |
| `npm run build`       | Production build                                                       |
| `npm run preview`     | Serve the production build                                             |
| `npm test`            | Unit tests (model, simulator, controller, routing, SQL against seed)   |
| `npm run test:db`     | Applies every migration to an in-process Postgres and checks it        |
| `npm run build:setup` | Rebuilds `supabase/setup.sql` from the migrations                      |
| `npm run typecheck`   | TypeScript, strict mode                                                |
| `npm run lint`        | ESLint and Prettier                                                    |

If the dev server keeps dying on a low-memory machine, use `npm run build` then
`npm run preview` instead. It needs a fraction of the memory.

## Two data modes

Set `VITE_DATA_MODE` in `.env.local` (copy `.env.example`).

- `demo` (default). `src/lib/demo-engine.ts` keeps the junctions, queues, signal plans,
  CCTV counts and history in memory and runs the same model code the server uses.
  The scenario panel lets you switch time of day, force a rush hour and block a lane.
- `live`. The dashboard reads and writes a Supabase project. The server functions in
  `src/lib/traffic.functions.ts` re-solve the network and advance the signals.

There is no public sensor feed for Chennai, so vehicle counts come from a demand
simulator in both modes, and the UI says so. The signal plans and predictions are real
calculations (Webster's method, the HCM delay equation) applied to that simulated traffic.
The demand curve is a synthetic daily shape, and `DEMAND_SCALE` in `sim-core.ts` was chosen
so the busiest approaches pass capacity at the peaks; it is a calibration choice, not a
measurement.

## How the model works

All of it is in `src/lib/traffic-model.ts` and `src/lib/sim-core.ts`, with tests next to
them.

1. **Arrivals.** Detector counts per window give an arrival rate in vehicles per hour,
   smoothed with an exponential average. Counts stay fractional so quiet roads are not
   rounded away.
2. **Saturation flow.** Each approach discharges at a fixed rate while it has green, after
   the first 4 seconds of every phase (start-up lost time).
3. **Webster's method.** From the flow ratios of the four approaches it solves the optimal
   cycle length and splits the green in proportion to demand. The cycle reported is always
   the sum of the greens plus the lost time, so the delay and saturation figures describe
   the plan that actually runs.
4. **Delay.** The HCM signalised-delay equation (uniform delay plus incremental delay over a
   15 minute period) gives the predicted wait per vehicle. It is continuous through
   capacity and never falls as demand rises.
5. **The fixed-timer baseline.** The adaptive plan is compared with a fixed plan that is
   Webster-optimal for the junction's *all-day average* demand, which is how a real timer
   is set. It is not simulated separately: both waits come from the same formula.
6. **Queue prediction.** Expected queue next = queue now + arrivals - expected discharge.
   The dashboard scores this against what happens and against the naive guess that the
   queue does not change. The scoring is against the simulator built from the same
   equations, so it shows the model matches its own assumptions, not that it matches roads.
7. **Phase controller.** Every 2 s it decides whether to keep or switch the green. Minimum
   8 s, maximum 90 s. A waiting approach pre-empts a running green when its pressure
   (degree of saturation, plus queue length, plus time spent waiting) beats the current one
   by 0.25. An approach that has been red for 120 s is served next whatever the pressures,
   once the running phase has had 20 s, so no arm is starved.

### What the numbers say

Against a timer set for average traffic, the adaptive plan predicts a wait about a quarter
shorter at the morning and evening peaks (for example 72 s against 95 s network-wide at
9 am) and almost no difference off-peak (25 s against 25 s at 3 am), because a timer tuned
to the average is already close to right when demand is average. At the peaks many
approaches are over capacity, and no timing plan can fix a road that is simply full.

The dashboard shows the change as a signed number, and next to it how many junctions the
adaptive plan is predicted to do *worse* at than the timer. Earlier versions of this
project compared against an equal-split 120 s timer, which made off-peak look like a 50 %
gain; that figure was an artefact of the weak baseline.

"Vehicle waiting avoided" is the modelled gain summed over every junction for the last hour
(each window credits the vehicles that arrived in it). It is a prediction, not something
measured, and it can be negative.

## Project layout

```
src/
  routes/index.tsx          the dashboard page
  components/ops/           map, search, time bar, place card, directions, attention list
  components/space/         3D junction view and the safe WebGL wrapper
  components/traffic/       lists, charts, camera wall, scenario controls
  lib/traffic-model.ts      Webster plan, HCM delay, junction solver
  lib/fixed-plan.ts         the fixed timer each junction is compared with
  lib/sim-core.ts           demand curve, queue step, phase controller (browser and server)
  lib/forecast.ts           steady-state forecast of every junction for any hour
  lib/routing.ts            OSRM client, junctions along a route, delay on a trip
  lib/demo-engine.ts        the in-browser world used in demo mode
  lib/traffic-data.ts       data access, demo or Supabase
  lib/traffic.functions.ts  server functions for live mode
  integrations/supabase/    Supabase clients and generated types
supabase/
  migrations/               schema, seed data (69 junctions, 276 approaches), control functions
  setup.sql                 all migrations in one file for a new project
  tests/                    checks run on an in-process Postgres
DESIGN.md                   visual design notes
docs/CRITIQUE.md            the adversarial review this version responds to
```

The 3D junction view is defensive: if WebGL is missing, the GPU resets, or the frame rate
collapses, it is replaced by a short note instead of failing the page, and it tries again a
couple of times when the tab is next visible. Rendering is capped at 24 frames per second and
pauses when the canvas is off screen.

### Limits worth knowing

- A route is charged for the 69 modelled junctions within 200 m of its line, at the
  junction-wide average wait, not for the particular arm it uses. Flyovers and parallel
  roads can be matched when they should not be. OSRM's own drive time already includes a
  small allowance per signal, so a little is counted twice.
- Forecasts assume the same demand every day: there is no weekday/weekend difference.
- The public OSRM server and OpenStreetMap tiles are free services for light use.

## Setting up your own Supabase project (live mode)

Demo mode needs none of this.

1. Create a project at supabase.com.
2. In the SQL editor, paste and run `supabase/setup.sql` once. It creates the schema, the
   69 junctions with their roads, signals and cameras, the control functions and views.
   (Or run the files in `supabase/migrations/` in filename order, which is the same thing.)
3. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key.
   Put the **service role key** only in `.env.local` as `SUPABASE_SERVICE_ROLE_KEY`;
   it must never be prefixed with `VITE_` or committed.
4. Set `VITE_DATA_MODE=live` and restart `npm run dev`.

If the backend cannot be reached, or the junction table is empty, the dashboard says so
instead of showing invented numbers.

### How the live control loop is protected

The two server functions that move the world forward can be called by anyone who can reach
the site, so they cannot be made secret, only made cheap. Each call first asks the
database for a ticket (`try_acquire_control`); only one caller per interval gets it (5 s for
the model tick, 1.5 s for the phase update), the rest return immediately. All writes go
through set-based SQL functions, the database allows only one green per junction, and the
`prune_old_rows` function owns data retention. The data is simulated, so the worst an
outsider can do is keep the simulation ticking. For anything real, move the loops to a
scheduled job and require a secret.

`supabase/tests/verify-migrations.mjs` (`npm run test:db`) applies the migrations to an
in-process Postgres and checks the constraints, the throttle, the handover function, the
trigger, the views and the permissions. Migration 2 was edited to insert roads in a fixed
order: without it, road ids came out in a different order from the one the app assumes.
