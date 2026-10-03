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
- **Directions.** Pick two junctions (or drop pins) and get routes with the delay of every
  signal on the way counted, the fastest route first, and how much the adaptive timing saves
  against fixed timers. Roads and base drive time come from OSRM's public demo server; if it
  cannot be reached the page says so and falls back to a straight-line estimate.
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

| Script              | What it does                             |
| ------------------- | ---------------------------------------- |
| `npm run build`     | Production build                         |
| `npm run preview`   | Serve the production build               |
| `npm test`          | Unit tests (model, simulator, map maths) |
| `npm run typecheck` | TypeScript, strict mode                  |
| `npm run lint`      | ESLint                                   |

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
simulator in both modes. The queue model, the timing plan and the predictions are real
traffic engineering; only the arrivals are simulated, and the UI says so.

## How the model works

All of it is in `src/lib/traffic-model.ts` and `src/lib/sim-core.ts`, with tests next to
them.

1. **Arrivals.** Vehicles that joined each approach's queue in the last window give an
   arrival rate in vehicles per hour.
2. **Saturation flow.** Each approach discharges at a fixed rate while it has green.
3. **Webster's method.** From the flow ratios of the four approaches it solves the
   optimal cycle length and splits the green in proportion to demand.
4. **Delay.** Webster's delay formula gives the predicted wait per vehicle for the
   adaptive plan and for a fixed plan (26 s green in a 120 s cycle).
5. **Queue prediction.** Queue next = queue now + arrivals - discharge. The dashboard
   scores this against what actually happens.
6. **Phase controller.** Every 2 s it decides whether to keep or switch the green:
   minimum 8 s, maximum 90 s, and a waiting approach pre-empts a running green only when
   its pressure (how far past capacity it is) beats the current one by 0.25, which stops
   the signal flapping.

### What the numbers say

Off-peak the adaptive plan predicts roughly half the waiting time of the fixed plan.
At rush hour demand is high enough that many approaches are over capacity, and no timing
plan can fix a road that is simply full: the network gain shrinks to a single-digit
percentage, and some junctions do slightly worse than the fixed timer. The dashboard
shows this as it is rather than hiding it.

## Project layout

```
src/
  routes/index.tsx          the dashboard page
  components/ops/           map, search, time bar, place card, directions, attention list
  components/space/         3D junction view and the safe WebGL wrapper
  components/traffic/       lists, charts, camera wall, scenario controls
  lib/traffic-model.ts      Webster maths
  lib/forecast.ts           steady-state forecast of every junction for any hour
  lib/routing.ts            OSRM client, junctions along a route, signal delay on a trip
  lib/sim-core.ts           queue step and phase decision shared by browser and server
  lib/demo-engine.ts        the in-browser world used in demo mode
  lib/traffic-data.ts       data access, demo or Supabase
  lib/traffic.functions.ts  server functions for live mode
  integrations/supabase/    generated client code
supabase/migrations/        schema and seed data (69 junctions, 276 approaches)
DESIGN.md                   visual design notes
```

The 3D junction view is defensive: if WebGL is missing, the GPU resets, or the frame rate
collapses, it is replaced by a short note instead of failing the page. Rendering is capped
at 30 frames per second and pauses when the canvas is off screen.

The forecast and trip times are modelled from the same demand rule the simulator uses, not
measured: vehicle counts are simulated, so a forecast is a model prediction, not a sensor
reading.

## Setting up your own Supabase project (live mode)

Demo mode needs none of this.

1. Create a project at supabase.com.
2. In the SQL editor, run the files in `supabase/migrations/` in filename order.
3. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key.
   Put the **service role key** only in `.env.local` as `SUPABASE_SERVICE_ROLE_KEY`;
   it must never be prefixed with `VITE_` or committed.
4. Set `VITE_DATA_MODE=live` and restart `npm run dev`.

`supabase/config.toml` and the committed `.env` still point at the original project;
replace the values with yours.
