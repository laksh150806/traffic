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
- **Take the tour.** One button runs a guided tour: a simulated day sweeps across the map with a
  live count of jammed junctions, the camera stops at the worst junction of each rush hour, then
  a trip is priced across the city. It drives the same controls a person would, so what it shows
  is the real model, played back quickly. Esc stops it.
- **Replay.** For the selected junction, the same half hour of simulated traffic is run twice,
  once under its fixed timer and once under the adaptive controller, and drawn as two queues over
  time with the wait, vehicles through and longest red side by side.
- **Inspector.** The queue model's numbers for the selected junction, with a 3D junction view
  of queued vehicles and the signal heads. The heads show amber and all-red during each
  handover, which is the 4 s of lost time the model charges every phase.
- **Operator control.** On any junction an operator can give one approach the green for a
  minute, and report an accident or road works on an approach. A held green never cuts the running
  green shorter than 8 s, keeps the 4 s amber and all-red, and ends by itself, so a forgotten
  override cannot freeze a junction. A report cuts that approach's capacity until it clears.
- **Emergency vehicle.** Send an ambulance from the selected junction to one of six hospitals. Each
  signal on its road changes to green just before it arrives (never cutting a green shorter than
  5 s) and returns to the controller after, and the panel counts the signals cleared, the waiting
  an ordinary vehicle would have had there, and the vehicles held on the side roads.
- **Green wave.** For a chosen trip, a time and distance diagram shows where a car at 40 km/h
  would meet red with the signals as they stand, and one button runs the wave: each signal turns
  green for the car as it arrives. Runs can be shown at real time, 4 times or 8 times faster.
  Priority order at a junction is ambulance, then an operator's hold, then a green wave.
- **Real traffic.** With a TomTom key, a badge says so, roads can be coloured by real speed, and
  each junction's card says how fast the roads around it are moving.
- **City board.** The headline numbers, the waiting avoided in vehicle-hours, a line of the average
  wait under the adaptive plan against a fixed timer, and a live activity feed.
- **Scenarios.** Rush hour, overnight, heavy rain (wet roads cut capacity by a fifth) and a
  blocked lane, to watch the plan respond. Weekends have their own demand shape.
- **For a keyboard.** Ctrl or Cmd plus K (or /) opens a palette to find a junction or run a
  command. On the map, Shift plus an arrow key jumps to the nearest junction in that direction.
- **Share and export.** The address bar always holds the current view, so _Share view_ copies a
  link to the same junction, time and trip. _Export CSV_ downloads the whole network at the time
  on the map.

## Run it

Requirements: Node.js 22 and npm.

```sh
npm install
npm run dev
```

Open the address Vite prints. It works straight away with no backend: by default the
app runs in **simulated mode** and simulates the whole network in the browser.

Other scripts:

| Script                               | What it does                                                            |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `npm run build`                      | Production build                                                        |
| `npm run preview`                    | Serve the production build                                              |
| `npm test`                           | Unit, component and live-loop tests (over 300, under a minute)          |
| `npm run test:db`                    | Applies every migration to an in-process Postgres and checks it         |
| `npm run rubric`                     | Runs the coursework SQL (`supabase/rubric`) and saves its output        |
| `npm run control`                    | Worker that keeps the live control loop running with no browser open    |
| `npm run build:setup`                | Rebuilds `supabase/setup.sql` from the migrations                       |
| `node scripts/fit-demand.mjs`        | Compares the demand curve with the datasets in `data/` (`docs/DATA.md`) |
| `node scripts/fetch-osm-signals.mjs` | Refreshes the mapped signal positions from OpenStreetMap                |
| `npm run typecheck`                  | TypeScript, strict mode                                                 |
| `npm run lint`                       | ESLint and Prettier                                                     |

If the dev server keeps dying on a low-memory machine, use `npm run build` then
`npm run preview` instead. It needs a fraction of the memory.

## Two data modes

Set `VITE_DATA_MODE` in `.env.local` (copy `.env.example`).

- `simulated` (default). `src/lib/sim-engine.ts` keeps the junctions, queues, signal plans,
  CCTV counts and history in memory and runs the same model code the server uses.
  The scenario panel lets you switch time of day, force a rush hour and block a lane.
- `live`. The dashboard reads and writes a Supabase project. The server functions in
  `src/lib/traffic.functions.ts` re-solve the network and advance the signals.

There is no public vehicle-count or signal feed for Chennai, so queues and vehicle counts come
from a demand simulator in both modes, and the UI says so. The signal plans and predictions
are real calculations (Webster's method, the HCM delay equation) applied to that traffic.
Without any keys, the demand follows a synthetic daily shape, and `DEMAND_SCALE` in
`sim-core.ts` was chosen so the busiest approaches pass capacity at the peaks; it is a
calibration choice, not a measurement.

## Real data, with no database

Three free sources make the simulation follow what Chennai is really doing. Each one is
optional and each falls back quietly to the simulation if it is missing or unreachable.

| Source                  | What it changes                                                                                                                                           | Setup                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **TomTom traffic flow** | How fast real traffic is moving on the roads around each junction sets how heavy the demand there is. The map can colour every road by real speed.        | A free key in `.env.local` as `TOMTOM_API_KEY` (server side only; never prefix it with `VITE_`). |
| **Open-Meteo**          | Real rain cuts capacity: light rain by 8 %, steady rain (2.5 mm an hour or more) by 20 %. It also covers the next two days in forecasts and trip pricing. | None: no key.                                                                                    |
| **OpenStreetMap**       | 28 of the 69 junctions sit on a real mapped signal, and every junction says whether its position was verified.                                            | None: positions are saved in `src/lib/osm-signals.json`.                                         |

How the TomTom speed becomes demand, in `src/lib/traffic-flow.ts` and `sim-engine.ts`:

1. The server (`/api/live-traffic`) reads TomTom's vector flow tiles for the area, once a
   minute at most whoever is looking, and takes the speed ratio (current over free-flow speed)
   of the road segments near each junction.
2. The ratio is turned into volume over capacity by inverting the Bureau of Public Roads delay
   curve, the standard link-speed model in planning software.
3. Each junction's demand is scaled so the model's volume over capacity matches that figure,
   moving half way to each new reading so one odd one does not jerk it. A reading older than
   ten minutes is ignored.
4. A free-flowing road (95 % of free-flow speed or more) can only lower demand, never raise it:
   free-flow speed cannot say how empty a road is, only that it is not near capacity.

What this is and is not: TomTom measures **speed on a road**, not vehicles or queues at a
signal. The queues, the signal plans and the savings are still computed by the model from the
demand those speeds imply. The speed-to-demand step is a planning rule of thumb. Ten junctions
have no road near their position in the project's seed, so they stay on the assumed curve, and
the 41 junctions whose position is not verified are marked approximate on their card.

The credits the three services ask for are shown in the city board: Traffic data © TomTom,
weather by Open-Meteo, signal positions © OpenStreetMap contributors.

The demand curve was also compared with two public traffic-count datasets that are not from
Chennai; `docs/DATA.md` has what that found, and `node scripts/fit-demand.mjs` repeats it.

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
   Webster-optimal for the junction's _all-day average_ demand, which is how a real timer
   is set. It is not simulated separately: both waits come from the same formula.
6. **Queue prediction.** Expected queue next = queue now + arrivals - expected discharge.
   The dashboard scores this against what happens and against the naive guess that the
   queue does not change. The scoring is against the simulator built from the same
   equations, so it shows the model matches its own assumptions, not that it matches roads.
7. **Phase controller.** Every 2 s it decides whether to keep or switch the green. Each green
   runs for the time the model allocates it (8 to 90 s). Another approach can pre-empt it only
   after it has held 60 % of that allocation (at least 8 s, at most 30 s) and only if its
   pressure (degree of saturation, plus queue length, plus time spent waiting) beats the
   current one by 0.8. An approach that has been red for 120 s is served next whatever the
   pressures, once the running phase has had 20 s, so no arm is starved. Every change of
   green costs 4 s in which nothing discharges, which the signal heads show as amber then
   all red.

### What the numbers say

There are two ways the app measures adaptive against fixed, and they are not the same
number. Keep them apart in a report.

**The delay formula** (the dashboard header, the forecast and the trip planner). It asks, for
steady traffic at one hour, what each plan's average wait would be.

**The replay** (the replay panel, and the figure the guided tour quotes). It runs the controller
that is actually on the map, in half-hour steps of 2 seconds, beside the junction's fixed timer
on identical arrivals, and counts the queues.

The replay is the stricter test, because it includes everything the formula ignores: queues
carried over, the 4 s lost at every change of green, the pre-emption rules. Writing it exposed a
real fault: with the controller's earlier rules (pre-empt after 8 s on a margin of 0.25) it
changed phase so often that it lost more time than it saved, and in the replay it did **worse**
than the fixed timer at the peaks (wait 10 to 13 % longer on average, worse at about 52 of 69
junctions) while the formula still claimed a gain. Holding each green for a share of its
allocation and widening the margin fixed it. With the rules above, over the 69 junctions
on a Monday:

| Moment         | Formula: wait cut | Replay: wait cut | Junctions worse in the replay |
| -------------- | ----------------- | ---------------- | ----------------------------- |
| 3 am           | 0 %               | about 23 %       | 0                             |
| 9 am (peak)    | 26 %              | about 41 %       | 4                             |
| 1 pm           | 1 %               | about 14 %       | 6                             |
| 6:30 pm (peak) | 29 %              | about 43 %       | 0                             |

The replay shows larger gains overnight than the formula, probably because a timer tuned to the week's
average keeps long cycles when almost nothing is waiting, and the formula (steady state)
does not charge for that as heavily. Both are measured on simulated demand. Neither is a
measurement of a real road, and the table above is one set of settings found by trying
combinations against the replay, so it flatters the controller a little: treat the direction as
the finding, not the exact percentages. The earlier, formula-only summary follows.

Against a timer set for the week's average traffic, the delay formula predicts a wait about a
quarter shorter at the morning and evening peaks (for example 75 s against 101 s network-wide
at 9 am) and almost no difference off-peak (25 s against 25 s at 3 am), because a timer tuned
to the average is already close to right when demand is average. At the peaks many
approaches are over capacity, and no timing plan can fix a road that is simply full.

The dashboard shows the change as a signed number, and next to it how many junctions the
adaptive plan is predicted to do _worse_ at than the timer. Earlier versions of this
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
  lib/traffic-flow.ts       TomTom speed tiles to a speed ratio per junction, and ratio to demand
  lib/flow-tiles.server.ts  server only: fetches and decodes the tiles (the key stays here)
  lib/weather.ts            Open-Meteo rain and what it does to capacity
  lib/osm-snap.ts           places junctions on real mapped signals
  lib/traffic-history.ts    the real road speeds seen so far, kept in the browser
  lib/vehicle-mix.ts        the assumed Chennai vehicle mix, queue length in metres
  lib/priority-run.ts       ambulance and green-wave runs, and the red-light projection
  routes/api/live-traffic.ts, traffic-tile.$z.$x.$y.ts   the server routes that hold the TomTom key
  lib/forecast.ts           steady-state forecast of every junction for any hour, and the busiest moments
  lib/replay.ts             half an hour at one junction, fixed timer against adaptive
  lib/signal-aspect.ts      green, amber or red for each head, from the 4 s lost time
  lib/share.ts, export.ts   links to a view, CSV of the network
  lib/map-nav.ts            keyboard movement between junctions
  lib/routing.ts            OSRM client, junctions along a route, delay on a trip
  lib/sim-engine.ts        the in-browser world used in simulated mode
  lib/traffic-data.ts       data access, simulated or Supabase
  lib/traffic.functions.ts  server functions for live mode
  lib/control-auth.ts       the secret check for the scheduled control endpoint
  routes/api/control.ts     POST /api/control, called by a scheduler to run the loop
  lib/testing/              an in-process Supabase stand-in used by the live-mode tests
  integrations/supabase/    Supabase clients and generated types
supabase/
  migrations/               schema, seed data (69 junctions, 276 approaches), control functions
  setup.sql                 all migrations in one file for a new project
  tests/                    checks run on an in-process Postgres
  rubric/                   coursework SQL: subqueries, views and joins, trigger, cursor, procedure
DESIGN.md                   visual design notes
```

The 3D junction view is defensive: if WebGL is missing, the GPU resets, or the frame rate
collapses, it is replaced by a short note instead of failing the page, and it tries again a
couple of times when the tab is next visible. Rendering is capped at 24 frames per second and
pauses when the canvas is off screen.

### Limits worth knowing

- A route is charged for the 69 modelled junctions within 200 m of its line. Flyovers and
  parallel roads can be matched when they should not be. OSRM's own drive time already
  includes a small allowance per signal, so a little is counted twice.
- Saturdays and Sundays have their own demand shape (no commuter peaks, a lunch plateau and
  an evening outing peak). It is a plausible shape, like the weekday one, not a measurement. The
  fixed timer is tuned to the whole week's average, as a real one would be.
- A route is priced on the arm of each junction it arrives on, worked out from its heading
  over the last 120 m. Turning movements are not modelled, so a vehicle that turns is charged
  the wait of the arm it came from.
- Rain cuts every approach's saturation flow by 20 % and changes nothing else, and the fixed
  timer does not know it is raining.
- The public OSRM server and OpenStreetMap tiles are free services for light use.

## Setting up your own Supabase project (live mode)

Simulated mode needs none of this.

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

### Keeping the loop running without a browser

By default an open page drives the loop (a tick every 12 s, a phase update every 2 s). That
only works while someone has the page open. To run it without one:

1. Choose a secret of 16 or more characters and put it in `.env.local` as
   `CONTROL_CRON_SECRET`.
2. Start something that calls `POST /api/control` with `Authorization: Bearer <secret>`:
   - the bundled worker: `CONTROL_URL=http://localhost:3000 npm run control` (on your own
     machine or any always-on host), or
   - Supabase's own scheduler: edit and run `supabase/scheduling.sql` once the app is deployed
     at a public address.
3. Set `CONTROL_BROWSER_DRIVEN=false` and `VITE_BROWSER_DRIVES_LOOP=false`. Open tabs then stop
   calling the control endpoints, and the browser endpoints refuse to do anything, so only a
   caller holding the secret can move the simulation.

`GET` and a wrong or missing secret get 401, an unset secret gets 500 (it never falls open),
and the database still throttles the work whoever calls.

### How the live control loop is protected

The two server functions that move the world forward can be called by anyone who can reach
the site, so they cannot be made secret, only made cheap. Each call first asks the
database for a ticket (`try_acquire_control`); only one caller per interval gets it (5 s for
the model tick, 1.5 s for the phase update), the rest return immediately. All writes go
through set-based SQL functions, the database allows only one green per junction, and the
`prune_old_rows` function owns data retention. The data is simulated, so the worst an
outsider can do is keep the simulation ticking. For anything real, move the loops to a
scheduled job and require a secret.

The live-mode server functions are tested for real: `src/lib/live-loop.test.ts` and
`src/lib/live-reads.test.ts` run the actual tick and phase-update code, and every dashboard
read, against the migrations on an in-process Postgres, through a small stand-in for the
Supabase client (`src/lib/testing`). They check one green per junction through many rounds,
the throttle, the trigger, blocked lanes, retention and the shape of every read. What they
cannot check is Supabase itself (PostgREST, row-level security, the real network), so the first
run against a real project may still turn up something.

`supabase/tests/verify-migrations.mjs` (`npm run test:db`) applies the migrations to an
in-process Postgres and checks the constraints, the throttle, the handover function, the
trigger, the views and the permissions. Migration 2 was edited to insert roads in a fixed
order: without it, road ids came out in a different order from the one the app assumes.
