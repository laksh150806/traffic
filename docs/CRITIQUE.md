# Adversarial review: Smart Traffic Management (branch `feature/ops-map-demo-mode`)

Reviewer scope: whole repo at HEAD `2c3ccbf` (4 commits on `main`), compared with `git diff main...HEAD`
where useful. Read-only review; nothing in the project was edited except this file.

## Status: what was done about each finding

Fixed means the code, tests and docs were changed and the change was checked. Partly means a
real improvement that stops short of the full fix, with what is left stated. Not done means a
conscious decision, with the reason.

| Finding | Status | What happened |
| --- | --- | --- |
| C1 starvation | Fixed | Ageing plus a hard 120 s red limit in `decidePhase`; queue weight raised; tie goes to the longest wait; handover waits 20 s so a chain of overdue arms each get a usable green. Longest red in 30 simulated minutes: 74 to 130 s (was 662 to 1696 s). Tests: unit tests of the rule and a 100-tick run in night and rush traffic. |
| C2 saved-time total | Fixed | Credit per window = gain x vehicles that arrived in it, signed, shown as modelled, over a stated window (last hour). Live mode reads the same from a view. |
| C3 adaptive vs fixed | Fixed | The baseline is now a Webster plan for each junction's all-day average demand. The result is shown signed with the count of junctions where adaptive is predicted worse. The old "half off-peak" gain was an artefact of the weak baseline and is gone (about 25 s against 25 s at 3 am; about a quarter shorter at the peaks). README and UI copy rewritten. |
| H1 delay formula | Fixed | HCM uniform plus incremental delay: continuous at x = 1, monotone in demand and in green (property tests). |
| H2 cycle vs greens | Fixed | The cycle is always the sum of the greens plus lost time (tested for lopsided demand). |
| H3 unauthenticated writes | Partly | The two server functions still accept any caller, because a browser cannot hold a secret. A database throttle (`try_acquire_control`) bounds the work to one tick per 5 s and one phase update per 1.5 s however many callers; documented in the README. Real authentication needs a scheduled job and is left for production. |
| H4 swallowed errors, races | Fixed | Every query is checked; the tick no longer rewrites who is green; handovers are applied in one SQL function junction by junction; two greens are impossible. Checked on an in-process Postgres. The TypeScript server functions themselves have still not run against a real Supabase project. |
| H5 invented fallback | Fixed | Removed. An unreachable backend or an empty database shows an explicit message. |
| H6 arrival estimate bias | Fixed | Counts stay fractional, floor 5 veh/h (was 60), smoother average; tested for no bias. |
| H7 integrity | Fixed | Composite foreign keys, one green per junction (partial unique index), check constraints, generated `abs_error`. |
| H8 logic in TypeScript | Partly | Added incidents table, a phase-change trigger, set-based functions, retention in SQL, views. The Webster solver stays in TypeScript (shared with the demo). The coursework queries, cursor and procedure are still to write. |
| H9 tests | Fixed | 55 to 123 tests: monotonicity, cycle consistency, controller fairness, saving size and sign, seeded simulator, seed against the SQL files, search, time helpers, aggregates, fixed plan. A second suite (`npm run test:db`) runs every migration on Postgres. Components still have no tests. |
| H10 panels disagree | Fixed | The place card uses the running model for the present and the forecast for later; the forecast knows the scenario and only includes blocked lanes still blocked at that time; live-only panels say so when a forecast is shown. |
| M1 pick-mode double click | Fixed | `bubblingMouseEvents: false`; checked in the browser (the start became the clicked junction, not "Dropped pin"). |
| M2 time drift | Fixed | The target is an absolute time. |
| M3 route selection | Fixed | Routes have a geometry id; selection survives re-ranking; stale routes cleared; map refits only when the set of roads changes. |
| M4 "1 min at 0 signals" | Fixed | Seconds under a minute; "no modelled junctions on the way". |
| M5 junction matching | Partly | Each junction is priced at the time the vehicle should reach it; wording says "modelled junctions"; routing errors are told apart. Still junction-wide, not per arm, and flyovers can be matched. Stated under Limits in the README. |
| M6 lost time | Partly | The first 4 s of each phase now discharge nothing. No amber or all-red phase is simulated. |
| M7 circular accuracy | Partly | The naive "no change" guess is scored alongside, and the panel says it is scored against the simulator. The model is not better than that guess in this simulator, and the UI shows it. |
| M8 colour | Fixed | A queue of 40 or 80 on any arm raises the level (TypeScript and the SQL view). |
| M9 incident model | Fixed | A blocked lane cuts the capacity of the busiest approach to 30 % (shared constant) instead of multiplying demand. |
| M10 demand cliff | Partly | Smooth ramps. No weekday/weekend difference; the curve is still synthetic. |
| M11 combobox | Fixed | Options, `aria-activedescendant`, announcements, no focus loss, timer cleared, larger clear button. |
| M12 reduced motion | Fixed | Global CSS rule, charts, camera loop and map fly check it. |
| M13 contrast | Partly | Muted and red text lightened, tiny text enlarged. Not measured in a browser. |
| M14 simulated labels | Fixed | The mode chip shows at every width; CCTV panels say simulated; page metadata updated. |
| M15 layout | Partly | Narrower side columns at laptop widths and a flex layout instead of a calculated height. The single-row time bar still needs a wide map. |
| M16 map access | Partly | Zoom buttons, one-finger drag left to the page on touch screens, map has a name. Junction markers are still not focusable; the search box and lists are the keyboard route. |
| M17 keyboard and screen readers | Mostly fixed | Tab panels with arrow keys, DOM order matches reading order, filter chips pressed state, icon names, summaries; larger targets on the main controls. |
| M18 churn | Mostly fixed | Markers memoised, geometry matching done once per route, previous data kept while switching junction. Polling is unchanged. |
| M19 indexes, limits | Fixed | Indexes for the time-only deletes; views replace 1600-row pulls. |
| M20 migrations | Fixed | Roads and cameras are inserted in a fixed order (verified: they were not on a fresh database, road 21 belonged to junction 20); unique junction names; the new migration is safe to run twice. Migration 2 was edited, which is fine for a new project and means an already-deployed one differs. |
| M21 `max_capacity` | Partly | Documented as a column comment. The meaning is unchanged. |
| M22 environment | Fixed | `.env.local` is loaded into the server's environment; no `process` reference in the browser; clear messages. |
| M23 dependencies | Fixed | 44 unused UI files and 38 unused packages removed. Charts are still in the main bundle. |
| M24 docs | Fixed | README, DESIGN.md and the roadmap match the code. |
| L1 .env tracked | Fixed | Untracked and ignored. |
| L2 allowedHosts | Fixed | Removed. |
| L3 third parties | Partly | Request timeout, tile URL and attribution link. Google Fonts still loads from Google. |
| L4 backwards clock | Fixed | Tested. |
| L5 duplicated constants | Fixed | One incident constant; the fixed green in history is the real plan's. |
| L6 attention list | Fixed | Lists only junctions that are not flowing, honours pick mode. |
| L7 hologram | Partly | Cars stay inside the road. Label textures are still drawn before the font loads. |
| L8 GL recovery | Fixed | Retries up to twice when the tab is visible again. |
| L9 tooling | Fixed | CI runs lint, types, tests, database tests and build on every push; vitest config modernised. No `og:image`. |
| L10 labels | Fixed | "Update #N"; `switched` counts handovers. |
| L11 CCTV axis | Fixed | Time axis. |
| L12 RLS | Not done | Public read is right for simulated data; revisit with real data. |

## How this was checked

| Check | Result |
| --- | --- |
| `npx vitest run` (once) | 5 files, 55 tests, all pass (0.45 s). Vitest prints a warning that `vite-tsconfig-paths` is redundant. |
| `npx tsc --noEmit` (once) | Exit 0, no errors. Did not crash. |
| `eslint src` (prettier rule off) | Only the accepted `prefer-const` error in `previewAuthStorage.ts` plus 8 `react-refresh` warnings. |
| Seed vs migrations | Wrote a script that parses both SQL migrations and `seed-junctions.ts`: all 69 junctions match on id order, name, zone, lat, lng and capacity (0 mismatches). Road-id order (`junctionIndex*4+approachIndex+1`, N,S,E,W) matches the order the `CROSS JOIN` inserts would produce if the planner emits (junction, direction) order; that planner order is not guaranteed (see M20). |
| Model / controller experiments | Copied `src/lib/*` to the scratchpad with relative imports and ran them under Node 24 (type stripping). Scripts: `D:\tmp\claude\D--study-claude-projects\b5beb4c7-f0e3-4983-8f87-e26711a5e39f\scratchpad\lib\e1.ts ... e11.ts`. Every number quoted below as "measured" comes from those scripts. |
| Browser | The preview on `localhost:5181` is stale: its HTML references `assets/index-B18LmCF1.js` and `assets/routes-D8eVbPOi.js`, both 404, while `dist/client/assets` now holds `index-BCJ6IKFc.js` and `routes-BSFS0MuI.js`. The page never hydrates there ("Updated: waiting for data", map spinner). That is a harness problem (server started before `dist` was rebuilt), not a project defect, but it means no visual or interaction testing was possible. UI findings are from code, CSS and computed values only. |

Things that were checked and are fine (so nobody re-investigates them):
IST maths (`timeOfDayFactor`, `istHourOf`, `formatIstTime`, `dayLabel`) is timezone independent and correct;
no service-role key or `sb_secret_` string in the client bundle or git history; no XSS sink outside the unused
shadcn `chart.tsx`; `forecastNetwork` costs about 0.4 ms (100 calls = 38 ms), so slider ticks are not a model-cost
problem; `ensureWorld()` warm-up is 42 ms; `distanceToSegment` projection is numerically sound; OSRM abort handling
has no race; forecast level class agrees with the live simulator (59/69 junctions at rush, 69/69 at night).

---

## CRITICAL

### C1. The phase controller starves approaches for tens of minutes; the model's "cycle" and "predicted wait" describe a controller that does not exist
- Where: `src/lib/sim-core.ts:114-117` (`approachPressure`), `:140-169` (`decidePhase`, tie-break at `:151`); consumed by `demo-engine.ts:380-418` and `traffic.functions.ts:445-527`.
- Problem: pressure is `degreeSaturation + queueNow/200`. Degree of saturation is a rate property that does not fall when an approach is served, and the queue term is capped at 0.75 (queue cap 150). A light approach with a large backlog therefore loses the "highest pressure" contest to approaches with empty queues and a higher DS, indefinitely. There is no max-red, aging or fixed phase order. Ties go to the lowest road id (North).
- Measured (demo engine, 150 ticks = 30 simulated minutes, separate process per mode):
  - default `auto` mode (what a user gets at 9 pm IST): 51 of 276 approaches had a red longer than 300 s, the longest 1696 s; 48 of 69 junctions have a max/min green-time ratio above 3 (worst 50.7).
  - `night`: longest red 662 s, ratio up to 17.5, 41/69 junctions above 3. `rush`: longest red 346 s.
  - Concrete case, `auto`: Thiruninravur Junction NORTH held green 12 s out of 1800 s while its queue grew 62 to 102 vehicles. At t=1798 s its pressure was 0.68 against 0.69 / 0.69 / 0.70 for E / S / W, whose queues were 0, 1 and 3. The panel shows for that approach: arrival 60 vph, DS 0.17, "cycle 62 s", predicted wait 21.9 s. Phase order printed over the run: `WESEWSWSESWEWSEWESWESWES...` (N never appears again). Tambaram shows `ENWNENWNENWENEWN...` (S starved).
  - The junction is coloured "Free flowing" because `levelFor` uses mean DS (see M8) although 102 vehicles are queued on one arm.
- Why it matters: the headline "predicted wait per vehicle" is a Webster formula for a cyclic plan with a stated cycle (60 to 150 s). The controller that moves the simulated queues is not cyclic, so a vehicle on a starved arm waits 11 to 28 minutes while the UI says 22 s. Real signals bound maximum red (typically 2 to 3 minutes). A reviewer who opens the junction card will see a 100-vehicle red arm next to "Free flowing".
- Fix: add an aging term (for example `pressure += secondsSinceLastGreen / K`) or a hard rule "any approach red for more than R seconds becomes the challenger"; weight the queue term so a backlog can outweigh DS; or run a fixed phase order with Webster durations and only extend/skip. Add a test: simulate N ticks and assert every approach is green at least once per `MAX_RED` seconds.
- Confidence: confirmed (reproduced three times, plus a pressure trace).

### C2. "Vehicle waiting avoided" is inflated 5x to 40x and counts only wins
- Where: `demo-engine.ts:331-332` (`Math.max(0, approach.savedVehicleSeconds)`, `w.savedTotalSec += saved`); `traffic.functions.ts:294`; `traffic-model.ts:181,202`; shown by `CycleChart.tsx:43` and `:15-19` (`formatSaved`).
- Problem, three stacked errors:
  1. `savedVehicleSeconds = (delayFixed - delayAdaptive) * arrivalsPerCycle`, where `arrivalsPerCycle` uses the model cycle (60 to 150 s). It is added once per control tick (every 12 s). A whole cycle's saving is therefore credited every 12 s (5x at a 60 s cycle, 12.5x at 150 s).
  2. Negative savings are clamped to zero before summing, so every approach where adaptive is predicted worse contributes nothing, while winners are counted in full.
  3. It is a model prediction (formula against formula), not an observed saving, but the chip says "of vehicle waiting avoided".
- Measured over 60 ticks (12 simulated minutes): `night` UI total 591,620 s (164 h) against 118,314 s from a signed per-window estimate = 5.0x. `rush` UI total 11,161,128 s (**3,100 h**) against 278,363 s signed = 40.1x (positive-only 1,049,195 s, so clamping alone is 3.8x and re-crediting 10.6x).
- Live mode is worse in a different way: `fetchTotalSecondsSaved` (`traffic-data.ts:182-194`) sums the last 2000 `signal_history` rows (PostgREST may cap that at 1000), i.e. about 3 to 7 ticks, so the live number is a sliding window, not a running total. Demo is cumulative since page load and resets on reload.
- Fix: credit `(dFixed - dAdaptive) * arrivalRate * elapsedSec / 3600` per tick, keep the sign, and label it "modelled, not measured"; compute the same way in both modes and say over what window.
- Confidence: confirmed.

### C3. The adaptive-vs-fixed result is not what the README and UI say
- Where: `README.md:80-86`, `index.tsx:375-383` (`Math.max(0, ...)`), `ModelPanel.tsx:76`, `PlaceCard.tsx:112-118`, `CycleChart.tsx:36-38`, `index.tsx:603-607`.
- Problems:
  1. At peak, adaptive is predicted worse than the fixed timer at **31 of 69 junctions** (6 pm, `forecastNetwork`): mean +41.2 s, worst +74.2 s per vehicle. At 8 to 10 am it is 16 of 69. README says "some junctions do slightly worse".
  2. The network "Predicted wait cut" and ModelPanel "Predicted congestion drop" clamp negatives to 0, and `PlaceCard` says "the fixed timer is about as good as adaptive" when adaptive is worse by up to 74 s. This contradicts the README line "The dashboard shows this as it is rather than hiding it".
  3. The off-peak "roughly half" gain is a cycle-length artefact: at 3 am every one of the 69 junctions solves to the 60 s minimum cycle with greens at or near the 12 s minimum, i.e. essentially an equal-split fixed plan, compared against a 120 s equal-split plan while the network never exceeds a degree of saturation of 0.32. The same demand under a 60 s equal-split fixed plan would be predicted almost identical. The baseline (26 s x 4 in 120 s, `traffic-model.ts:27-32`) is a straw man; a fair fixed-time baseline is Webster optimised for the daily mean flow.
  4. Nothing is simulated under the fixed plan. `delayFixed` is the same formula evaluated at (120, 26). CycleChart says "the same demand run on a fixed plan"; it is not run.
  5. UI copy says "The queue model, timing plan and predictions are real traffic engineering" (`index.tsx:603-607`), which H1/H2 and C1 undermine.
- Measured (forecast, steady state): network mean adaptive/fixed delay 20.0/40.1 s at 3 am (50 percent), 29.6/51.7 at noon, 106.3/137.3 at 9 am, 139.9/152.1 at 6 pm (8 percent).
- Fix: report signed numbers, add a "junctions where fixed is better: N" readout, use a daily-mean Webster plan as the fixed baseline (and also keep the naive one, labelled), rename "run on" to "evaluated for", soften the engineering claim.
- Confidence: confirmed.

---

## HIGH

### H1. `websterDelay` is non-monotone and has a cliff at x = 1; oversaturated results are noise
- Where: `traffic-model.ts:124-136`.
- Problem: the random term is capped at `xc = min(x, 0.98)` and becomes `0.96/(2q*0.02)`, which falls as `q` rises. The oversaturation term uses `(x-1)*cycle/2` (cycle 60 to 150 s) instead of an analysis period, so it grows very slowly. Result: delay drops as demand increases past capacity.
- Measured (cycle 120, green 26, s = 2160 vph): q=400 -> 67.8 s, 450 -> 142.7, 468 -> 231.7, 500 -> 224.9, 600 -> 212.0, 700 -> 207.7, 900 -> 214.5. At q=450 changing green 24 -> 26 -> 28 gives 243 -> 143 -> 74 s. Both plans sit on the ~210 to 230 s plateau when x > 1, so "adaptive vs fixed" there is determined by which side of x=1 each plan lands on (this is why C3.1 happens: equalising DS puts every approach at x about 1.0 to 1.2, while the fixed plan keeps the lightly loaded arms at low delay).
- Also: the Webster third (negative) term is omitted; the `Y` clamp at 0.92 (`:159`) silently applies the cycle formula where Webster's method is invalid (Y >= 1).
- Fix: use a continuous oversaturated delay (HCM d1+d2+d3 with T = 0.25 h) or at least keep the delay non-decreasing in q; add property tests (monotone in q, non-increasing in green).
- Confidence: confirmed.

### H2. Greens do not add up to the cycle, so delays and DS are computed on a cycle that is not the plan
- Where: `traffic-model.ts:159-166` (`MIN_GREEN`, `effectiveGreenTotal`, per-approach clamp) and `:187-188` (DS uses `cycleLength`).
- Problem: `cycleLength` is clamped to [60,150] first, then each green is clamped to [12,90] independently, so `sum(green) + 16 != cycleLength`. `websterDelay` and DS then use `green/cycleLength` for a cycle that is really `sum(green)+16`.
- Measured: at 3 am `sum(green)+lost != cycle` at 69/69 junctions (off by 4 to 15 s, >10 s at 14); at noon 62/69. Example: rates 60/60/60/900 vph give cycle 60, greens 12/12/12/40 (sum 92 with lost time). Reported flow-weighted adaptive delay 9.9 s; with the consistent cycle of 92 it is **64.0 s** (6.5x understatement), which also inflates the "gain" against the fixed plan (185 s) from 65 percent to 95 percent.
- Fix: after clamping, set `cycleLength = sum(green) + lostTime` (or renormalise greens to the cycle); test the invariant.
- Confidence: confirmed.

### H3. Live mode: mutating server functions are unauthenticated and run with the service role
- Where: `traffic.functions.ts:41` (`runTrafficTick`), `:445` (`advanceSignals`); `start.ts:20-24`.
- Problem: any HTTP client can POST both functions. The CSRF middleware only checks browser cross-site requests. `runTrafficTick` runs four selects (including up to 1600 `vehicle_counts` rows) before its 5 s guard at `:91` can skip; when it does not skip it performs hundreds of inserts/upserts and four deletes per call. `advanceSignals` has no rate guard at all (two full-table selects per call). Also, the "control system" only runs while some browser tab is open, and every tab runs it (2 s and 12 s intervals in `index.tsx:300,323`), so N viewers multiply load on the project.
- Fix: require an auth header / shared secret (the unused `cron-auth.ts` pattern), move the loops to a scheduled job, add a server-side rate limit.
- Confidence: confirmed by reading; live path never run.

### H4. Live mode: write errors are swallowed, and the tick races itself and the controller
- Where: `traffic.functions.ts:136,348,351,354,358,407-410` (no `error` check on any write or delete; function still returns `ok: true`); `:87-93` (read-check-write, not atomic); `:308-339` (re-reads `signal_timings` then upserts the stale `is_currently_green`); `:526` (`switched: updates.length` counts rows, not switches).
- Scenarios: (a) an RLS or column mismatch silently leaves the dashboard frozen on stale data with no message; (b) two tabs calling the tick within one round trip both pass the 5 s guard, double-insert history rows and reuse the same `cycle_number`; (c) `advanceSignals` switches a phase between the tick's read and its upsert, the tick writes back the old phase and `updated_at`, silently reverting the switch (no double green, but the countdown restarts).
- Fix: check and throw on `error`; make the tick a single SQL function or use `upsert ... where updated_at < now() - interval '5 s'`; do not rewrite `is_currently_green` from the tick.
- Confidence: confirmed by reading (never executed against a database).

### H5. Live mode shows fabricated junction readings when the backend fails, and no query error is ever shown
- Where: `index.tsx:75-131` (hard-coded `FALLBACK_JUNCTIONS` with made-up counts and levels), `:183-191`, `:177-181`; no `isError` handling anywhere except `DirectionsPanel` (grep: only `index.tsx:290,317` log to console).
- Scenario: Supabase unreachable -> after React Query's 3 retries the map shows five invented junctions ("Vandalur: HIGH") under a header chip reading "Live backend". `selectedForecast` is undefined for ids -1..-5 (`:228`), so the whole right column stays a skeleton forever. Same for an empty database (`data.length === 0` also falls back, `:184-189`).
- Fix: render an explicit "Backend unavailable" state; never fall back to invented numbers.
- Confidence: confirmed by reading.

### H6. The arrival-rate estimator is biased by integer rounding and a 60 vph floor, and it feeds both DS and the controller
- Where: `sim-core.ts:90` (`measuredArrivals = round(arrivals * (0.9..1.1))` for a 12 s window), `traffic-model.ts:93-96` (EWMA, `clamp(..., 60, 2600)`).
- Problem: one 12 s window at 100 vph contains 0.33 vehicles, which rounds to 0 every time, so the estimate collapses to the 60 vph floor; at 154 vph the 1-vehicle quantum gives 300 vph.
- Measured at night: mean error -18.5 percent, 170/276 approaches under-estimated by more than 20 percent (e.g. true 114 -> est 60, true 94 -> 60, true 154 -> 292). At rush: -1.2 percent. This makes DS, pressure and the displayed "Arrivals" column wrong exactly where C1 bites, and means forecast (exact demand) and live (quantised) disagree at night (mean queue 0.6 vs 2.0).
- Fix: accumulate fractional arrivals (do not round per tick) or estimate over a longer window; do not floor at 60 vph.
- Confidence: confirmed.

### H7. Database normalisation and integrity: redundant `junction_id` with no composite FK, no "one green per junction" invariant, no CHECKs
- Where: `20260906130148...sql:52-64` (`signal_timings`: `junction_id` plus `road_id UNIQUE`), `:66-76` (`signal_history`), `20260907145344...sql:10-25` (`model_road_state`), `:33-41` (`model_accuracy`); `roads.direction VARCHAR(10)` at `:18`, `status`/`timing_mode`/`source` free text.
- Problems: `junction_id` is functionally determined by `road_id` in four tables (3NF violation), and nothing prevents a row whose `junction_id` is not the road's junction (needs `UNIQUE(road_id, junction_id)` on `roads` and a composite FK). Nothing stops two approaches being green at once at a junction (a partial unique index on `signal_timings(junction_id) WHERE is_currently_green` would). No CHECK on direction, `vehicle_count >= 0`, `green_duration_sec` range, lat/lng range, `confidence_avg` in [0,1]. `model_accuracy.abs_error` is a stored derived attribute. A course rubric on normalisation and constraints will hit all of these.
- Confidence: confirmed.

### H8. The schema is a storage layer for logic that lives in TypeScript, so the PL/pgSQL, cursor and subquery rubric items have nothing natural to attach to
- Where: whole `supabase/migrations`; `traffic.functions.ts`.
- Problems that will block the rubric work: (1) Webster solving, queue stepping and phase decisions are TypeScript (shared with the demo), so any trigger/procedure either duplicates them (two sources of truth) or replaces the app code; (2) retention is done by the app (`traffic.functions.ts:405-411`: 25 min of counts, 60 min of CCTV and accuracy, 90 min of history), leaving at most about 1.5 hours of data, so cursor reports and aggregate/nested queries over history are thin; (3) no tables for incidents (the "block a lane" scenario exists only in demo memory), operators/users, or audit; (4) policies are `SELECT USING (true)` only, so any `rpc()` function needs `SECURITY DEFINER`/explicit grants, which is not planned anywhere; (5) `v_junction_congestion` is the only view.
- Fix: decide up front which of {Webster solve, one-green enforcement, retention, incident handling} moves into SQL, add `incidents` and an audit table, and move retention into the DB (trigger or pg_cron).
- Confidence: likely (design judgement).

### H9. Tests cover easy facts, miss the invariants that fail, and several cannot fail
- Where: `demo-engine.test.ts:110-114` ("accumulates avoided waiting as it ticks": `toBeGreaterThanOrEqual(before)` is always true because the total is monotone; also runs on a different clock from the other tests, `Date.now()+30000` vs the module's simulated `clock`), `forecast.test.ts:37-41` (adaptive never worse than fixed, only at 3 am; the peak case that fails 31/69 is untested), `traffic-model.test.ts:65-83` (bounded, not monotone; limits tested but not `sum(green)+lost == cycle`), `routing.test.ts:138` (asserts `formatMinutes(30) == "1 min"`, cementing M4).
- Missing: monotonicity of delay in demand/green, cycle/green consistency, controller fairness (C1), saved-total plausibility (C2), `traffic-aggregate.ts` (aggregate/performance), `searchJunctions`, `TimeBar.minutesUntil`, `levelFor` and `timeOfDayFactor` boundaries (8:00, 10:00, 17:00, 20:00, 23:00) and midnight wrap, `traffic.functions.ts` and the Supabase branch of `traffic-data.ts` (zero coverage; vitest runs in `environment: node` and `include` is only `src/**/*.test.ts`, so no `.tsx` component test can exist), seed-vs-SQL equality (only count and unique ids are checked).
- Flakiness: demo-engine tests share a module-level `world` and `scenario` singleton and depend on file order; the simulator uses unseeded `Math.random`; one test mixes `Date.now()` and a simulated clock. They are stable today because thresholds are loose (night: DS never above 0.2), not because they are deterministic.
- Confidence: confirmed.

### H10. Panels in the same view disagree: forecast-based vs live, and the forecast ignores the scenario and misapplies incidents
- Where: `forecast.ts:85-87`, `index.tsx:199-209,369`, `PlaceCard.tsx:105-109`, `Attention.tsx:12-17`, `index.tsx:375-383`.
- Problems:
  1. `PlaceCard` always shows steady-state forecast waits (even at offset 0), while the level pill uses the live level and `ModelPanel`/`CycleChart` show live model numbers. Two different "wait per vehicle" figures for one junction on screen.
  2. `forecastNetwork` knows nothing of the Scenario mode. Click "Rush hour": the map goes red (live engine at factor 1.9) but `PlaceCard`, `Attention` reasons and Directions colours/delays still use the clock's factor (for example 0.9 at 9 pm), so the pill says "Jammed" next to "Adaptive timing cuts the wait by 50 percent".
  3. Active incidents (150 s long, `triggerIncident` default) are passed as boosts to forecasts for any time, so "tomorrow 9 am" shows the lane block.
  4. "Predicted wait cut" in the stats grid uses the live `performanceQuery` even when the time bar is on a forecast, while the other three stats switch to forecast.
  5. The lower right column (RoadList, ModelPanel, CycleChart, cameras) stays live while the card says "Forecast for 9:00 am".
- Fix: pass `scenarioMode` and incident expiry into the forecast; derive PlaceCard numbers from the live model when `!isForecast`; label live-only panels.
- Confidence: confirmed by reading.

---

## MEDIUM

### M1. Pick-on-map: clicking a junction also fires the map click and overwrites the endpoint with a "Dropped pin"
- Where: `OpsMap.tsx:92-97` (`useMapEvents click`), `:185` (marker click), `index.tsx:344-360`.
- Reason: Leaflet `Path` has `bubblingMouseEvents: true` (verified in `node_modules/leaflet/src/layer/vector/Path.js:74`), so the marker's click is followed by the map's click. `select` sets the junction, then `dropPin` (using the stale closure `pick`) sets `{lat,lng,label:"Dropped pin"}` at the click point. The on-screen hint promises "Click a junction or anywhere on the map". The route-polyline click (`:145`) has the same problem.
- Fix: `L.DomEvent.stopPropagation` in the marker handler, or ignore map clicks that came from a layer.
- Confidence: likely (library behaviour read from source; not executed).

### M2. Forecast time drifts by 5 minutes every 5 minutes
- Where: `index.tsx:194-195` (`base` snaps to 5 minutes and moves with `clock`, `at = base + offsetMin`), `TimeBar.tsx:30`.
- Scenario: user clicks "Evening peak" at 5:58 pm (offset computed against base 5:55) -> 6:30 pm. At 6:00 pm base becomes 6:00 and the view silently becomes 6:35 pm. The label "Live" also shows a time up to 5 minutes (+30 s) old.
- Fix: store the target as an absolute timestamp, not an offset.
- Confidence: confirmed.

### M3. Directions: stale routes while loading; re-ranking swaps the selected route and refits the map
- Where: `useDirections.ts:31-57` (`fetched` is not cleared when the key changes between two valid endpoints, so old routes stay drawn for the new pins until the response arrives), `:59-71` (re-sorted by `rankRoutes` every time `forecast` changes), `OpsMap.tsx:61-71` (`routeKey` includes order, so a re-rank refits the map despite the comment), `DirectionsPanel.tsx:149` (`key={index}`, `open` state is index-based), `index.tsx:336` (selection reset only when the count changes).
- Scenario: user highlights route #2; dragging the time bar or the 6 s refresh changes the ETA ordering; index 1 is now a different road, the highlight jumps and the map flies.
- Fix: key routes by geometry hash, keep selection by id, clear `fetched` on key change.
- Confidence: confirmed by reading.

### M4. `formatMinutes` floors at one minute
- Where: `routing.ts:193-197`, used at `DirectionsPanel.tsx:174`.
- Scenario: a route crossing no modelled junction renders "12 min driving plus 1 min at 0 signals". A 20 s delay shows as "1 min".
- Fix: print seconds under a minute, or "none".
- Confidence: confirmed.

### M5. Junction matching and signal sums are cruder than the UI implies
- Where: `routing.ts:43,73-112,117-151`, `useDirections.ts:59-71`.
- Problems: (a) 200 m flat distance to the polyline with no direction or approach, so the delay added is the junction-wide flow-weighted mean, not the arm the route uses; (b) parallel arterials within 200 m are matched (false positives), grade-separated routes (Gemini Flyover, Padi Flyover, Kathipara, Basin Bridge, Saidapet and Kodambakkam bridges are in the seed) are charged a ground-level signal delay; (c) seed coordinates are hand-rounded to 3 decimals (up to about 78 m radial error) and are approximate (Kathipara and Alandur are 597 m apart), so 200 m both misses and over-matches; (d) a junction used as the start or end point is counted in full; (e) all junctions are priced at the departure time, not the arrival time at each junction; (f) only the 69 modelled points are "signals", but the panel says "N signals" and the README says "the delay of every signal on the way counted" (`README.md:14-15`); (g) OSRM's own car profile already includes a per-signal penalty.
- Measured: straight line between every junction pair (the fallback geometry): junctions matched min/median/mean/p90/max = 2/2/2.7/4/8 including both endpoints, so the median straight route crosses zero intermediate junctions. Peak signal delay averages 140 s per junction (max 263 s), so Guindy -> Kathipara (about 8 min of driving) is priced at +430 s. The "routes cross 3-4 of 69 junctions" claim does not appear in README or UI; real OSRM geometry was not fetched (see "could not verify").
- Confidence: confirmed (stats), likely (real-road effects).

### M6. No amber/all-red, and the simulator has no lost time while the model charges 4 s per phase
- Where: `sim-core.ts:94-97`, `demo-engine.ts:380-418`, `traffic-model.ts:25,144`.
- Problem: phases hand over instantly (A green -> B green in the same step); the queue simulation discharges at full saturation flow for the whole window. The delay formulas assume 16 s of lost time per cycle. The two halves of the system disagree on capacity by 10 to 25 percent at short cycles. No clearance interval is also not something a signal controller may do.
- Fix: add an all-red/amber phase (3 to 6 s) in `decidePhase` and in the discharge accounting.
- Confidence: confirmed.

### M7. "Queue forecast accuracy" is circular and trivially high at night
- Where: `demo-engine.ts:255-264,301-308`, `ModelPanel.tsx:82-89`.
- Problem: the prediction is scored against a simulator built from the same equations, and `dischargeNext` assumes the highest-DS approach gets the next green (`:287-294`) although the real controller picks otherwise (C1). At night queues are about zero, so 99.3 percent of predictions fall within 3 vehicles (measured hit rate 0.993 night, 0.70 rush, MAE 0.52 / 2.37). No persistence baseline ("queue stays as is") is shown, so the number carries no information.
- Confidence: confirmed.

### M8. Junction colour uses the mean DS only, so huge queues can be "Free flowing"
- Where: `sim-core.ts:19-23`, `demo-engine.ts:441-452`, `migration 20260910145231...sql:23-32`.
- Scenario: C1's junction (one arm 102 vehicles, others 0 to 3) is mean DS 0.56 -> LOW. The "Needs attention" list ranks by that level first.
- Fix: use max DS or add a queue-based override.
- Confidence: confirmed.

### M9. "Block a lane" is modelled as demand x2.6 on all four approaches, not as lost capacity on one
- Where: `demo-engine.ts:181-189,248`, `index.tsx:139` (separate copy of 2.6 for the forecast: they can drift).
- Fix: reduce `saturationFlow` for one approach; share the constant.
- Confidence: confirmed.

### M10. Demand curve has a cliff and ignores days
- Where: `sim-core.ts:26-33`.
- Problem: 23:00 to 08:00 is one level (0.45), so 7:55 -> 8:00 jumps the network from 0 HIGH to 19 HIGH / 44 MODERATE (measured `forecastNetwork` at hours 7 and 8), and 6 to 8 am is "night". No weekend/weekday difference. The 5-minute slider makes the cliff visible as a flip.
- Confidence: confirmed.

### M11. SearchBox combobox ARIA is incomplete
- Where: `SearchBox.tsx:95-108,127-162`.
- Problems: no `aria-activedescendant`, so arrow keys change a highlight screen readers cannot follow; `aria-controls` points at an element that does not exist while closed; the listbox contains a plain `<li>` ("No junction matches") that is not an option; each `role="option"` wraps a `<button>`; no live announcement of result count; `input.blur()` on choose (`:66`) drops focus to `<body>`; `onBlur` timeout (`:108`) is never cleared; clear button is 22 px (`:120`, below WCAG 2.2 target size 24 px).
- Confidence: confirmed by reading.

### M12. Reduced motion is only partly honoured, contrary to DESIGN.md
- Where: `DESIGN.md:46` ("Everything respects prefers-reduced-motion"), `styles.css:258-262` (only `.signal-live`), `OpsMap.tsx:78` (`flyTo` 0.8 s), `animate-spin` on `RefreshCw`/`Loader2`, `transition-data` (350 ms), Recharts `animationDuration={350}` (`CycleChart.tsx:90,99`, `CctvPanel`), `CameraWall.tsx:192` (900 ms stepping loop with 1.4 unit jumps).
- The 3D scene, `TiltCard` and `AnimatedNumber` do honour it.
- Confidence: confirmed.

### M13. Contrast and text size on glass (computed, not measured in a browser)
- Where: `styles.css:61-88,151-162`; small text: `text-[9px]` (`CameraWall.tsx:162`), `text-[10px]`/`[11px]` across `JunctionList`, `PlaceCard`, `ModelPanel`, `RoadList`.
- Estimate (WCAG relative luminance on the brightest aurora blob under `.panel` plus its top-left sheen): `muted-foreground` 3.5:1 (5.7:1 without sheen), `signal-high` text 2.6 to 4.3:1, search placeholder (`/70`) about 2.4:1. Body `foreground` is fine (7.7:1+). `signal-high` and `muted-foreground` fail 4.5:1 for 9 to 11 px text.
- Confidence: likely (needs a screenshot pass).

### M14. Simulated-data disclosure is missing in places
- Where: `DashboardHeader.tsx:71` (`hidden ... sm:flex`: the "Demo data" chip, its tooltip and the "Updated" text do not exist below 640 px), `CctvPanel.tsx:26,31` ("Live feed", red "LIVE" chip, no "simulated"), `CameraWall.tsx:207` ("exactly the count feeding the signal model" while the CCTV panel uses a separate noisy 0.88-1.12 count), `CameraWall.tsx` prints "frame N" and "% confidence" for an SVG drawn from `queue`.
- DESIGN.md's rule "the UI says so" therefore fails on phones and in the CCTV panel. The root `<title>`/description (`__root.tsx:81-85`) still advertise "CCTV detection".
- Confidence: confirmed.

### M15. Desktop layout leaves the map small on common laptop widths; magic numbers
- Where: `index.tsx:412` (`lg:grid-cols-[290px_minmax(0,1fr)_330px] xl:grid-cols-[350px_minmax(0,1fr)_430px]`, `lg:h-[calc(100vh-96px)]`), `:557` (`top-[68px]` banner).
- Computed map width (viewport - 32 padding - 24 gaps - side columns): 1024 px -> 348 px, 1280 px -> 444 px, 1366 px -> 530 px, 1440 px -> 604 px, 1920 px -> 1084 px. The 576 px container query (`@xl`) for the single-row TimeBar is not reached below a viewport of about 1410 px (map width = viewport - 836 at `xl`), so on a 1280x720 laptop the time bar stacks (about 170 px) and the HUD (search + legend) takes about 100 px of a roughly 624 px tall, 444 px wide map. If the header wraps, 96 px is wrong and the bottom of the page is clipped by `lg:overflow-hidden`. The pick banner at `top-[68px]` likely overlaps the legend row when it wraps at narrow widths.
- Confidence: likely (arithmetic from classes; not rendered).

### M16. Map accessibility and mobile behaviour
- Where: `OpsMap.tsx:120-123` (`preferCanvas`, `zoomControl={false}`).
- Problems: junction markers are canvas paths, not focusable or exposed to assistive tech (the lists are an alternative for selection, but "pick on map" is mouse-only); there are no on-screen +/- zoom buttons (the CSS styles for them exist at `styles.css:274`); on touch devices a one-finger drag pans the 520 px map instead of scrolling the page (scroll trap); the map container has no accessible name.
- Confidence: likely.

### M17. Other keyboard / screen-reader gaps
- `index.tsx:415-433`: `role="tablist"`/`tab` with `aria-selected` but no `tabpanel`, `aria-controls` or arrow-key roving.
- `index.tsx:414,508,570` + DOM order: below `lg` the map is visually first (`order-1`) but the left panel precedes it in DOM, so tab order differs from visual order (WCAG 2.4.3).
- Colour-only level coding: dots in `JunctionList.tsx`, `SearchBox`, DirectionsPanel stop list; `ModelPanel.tsx:121-125` queue-clears icons have no accessible name; `RoadList.tsx:104` puts `aria-label` on a bare `<span>` (needs `role="img"`); `JunctionList.tsx:81` filter chips have no `aria-pressed`; `PlaceCard.tsx:128-140` day chart uses `title` only; `DirectionsPanel.tsx:159` uses `aria-pressed` for what is also an expand/collapse (needs `aria-expanded`); `ScenarioPanel.tsx:66` hints are `title` only; `<summary class="list-none">` (`index.tsx:474`) removes the disclosure marker with no replacement.
- No live region announces forecast mode, selection change or route results (only the loading line has `role="status"`).
- Touch targets under 44 px: pick buttons 36 px, tabs about 30 px, chips about 26 px, time-bar buttons about 28 px.
- Confidence: confirmed by reading.

### M18. Re-render and recompute churn
- `useDirections.ts:59-71` recomputes `junctionsAlongRoute` (O(69 x points x routes), about 45 ms for 3 routes of 6000 points, 100 ms at 15,000) on every `forecast` identity change. `forecast` is a new `Map` every 6 s because `boosts` is rebuilt on `junctionsQuery.dataUpdatedAt` (`index.tsx:199-209`) and on each slider event. Geometry matching does not depend on the forecast and should be memoised per route.
- `OpsMap.tsx:176,178` creates new `center` arrays and `pathOptions` objects on every render; `@react-leaflet/core/lib/circle.js` compares `center` by identity, so every Dashboard render calls `setLatLng` and `setStyle` on 69 markers (and the Dashboard re-renders every 2 to 6 s). Wrap in `React.memo` with stable props.
- `index.tsx:277-279` invalidates every query every 12 s on top of 8 independent `refetchInterval`s (`:180,240-274`); in live mode that is about 8 requests per 6 s per tab plus the 2 s advance loop. `CameraWall.tsx:192` and `RoadList`/`PlaceCard` run 1 s and 0.9 s timers that keep re-rendering in hidden tabs.
- `index.tsx:590` unmounts and remounts the whole WebGL `Canvas` on every junction switch (roads are `[]` while loading), creating a new GL context each time; no `placeholderData: keepPreviousData` anywhere, so all right-hand panels flash skeletons on each selection.
- Confidence: confirmed (timings), likely (context churn).

### M19. Live-mode indexes, retention deletes and PostgREST limits
- Where: `traffic.functions.ts:55-61,160-164,405-411`, migration 1 lines 46, 77, 91.
- Problems: the retention deletes filter on `recorded_at`/`decided_at`/`analyzed_at` alone, but the indexes are `(road_id, recorded_at)`, `(junction_id, decided_at)`, `(camera_id, analyzed_at)`, so three of four deletes cannot use an index and run as sequential scans every tick; the tick's `vehicle_counts` query (`source = 'SIMULATED_SENSOR' ORDER BY recorded_at DESC LIMIT 1600`) has no usable index; no index on `cctv_cameras(road_id)`, `signal_history(road_id)`, `signal_timings(junction_id)`. `.limit(1600)`/`.limit(2000)` exceed Supabase's default `max-rows` of 1000, so they are silently truncated (affects `fetchTotalSecondsSaved`, C2).
- Confidence: likely (default API setting assumed).

### M20. Migrations are not idempotent and are coupled to serial ids; seeds only "mirror" loosely
- Where: migration 1 lines 121-147, migration 2 lines 3 and 71-107.
- Problems: re-running `INSERT INTO junctions` duplicates all rows (no `UNIQUE(name)`); `UPDATE ... WHERE junction_id BETWEEN 1 AND 5` and the road-id numbering assume a fresh sequence and the planner emitting the `CROSS JOIN` in (junction, direction) order (not guaranteed without `ORDER BY`; the demo, `roadIdFor` and the per-road load personality `loadFor(roadId)` all depend on it); migration 1 seeds counts as `20+(road_id*13)%55` but migration 2 uses `abs(hashtext(...))%55`, so the initial counts differ from `demo-engine.ts:130` for roads above 20 while `seed-junctions.ts:1` claims they mirror each other; seeded `signal_history` rows carry invented `estimated_wait_saved_sec` and `baseline_fixed_sec = 30` (the app uses 26); `model_road_state.cycle_length_sec DEFAULT 120`, `saturation_flow_vph DEFAULT 1800` are unrelated defaults. `supabase/config.toml` and `.env` still point at the original project, so `supabase db push` targets someone else's project.
- Confidence: confirmed (idempotency, mismatch), speculative (planner ordering).

### M21. `max_capacity` means two different things
- Where: migration 1 line 20; `traffic-model.ts:39-41` (`1800*(cap/100)` saturation flow clamped 900 to 2400); `RoadList.tsx:14-18,55` (`count / max_capacity` as a vehicle-storage percentage); `sim-core.ts:73` (`/4` hard-coded; `forecast.ts:17` has `APPROACHES_PER_JUNCTION`).
- Problem: a "vehicle capacity" of 100 to 140 doubles as a saturation-flow scale; the column cannot be documented honestly, and a T-junction (3 approaches) would silently get the wrong demand scale.
- Confidence: confirmed.

### M22. Live-mode environment handling is unverified and has traps
- Where: `client.ts:34-35`, `client.server.ts:33-44`, `README.md:121-124`.
- Problems: server functions read `process.env['SUPABASE_URL']` / `SUPABASE_SERVICE_ROLE_KEY`, but the README tells the user to put them in `.env.local`; Vite loads only `VITE_`-prefixed variables into `import.meta.env` and does not populate `process.env`, so whether `vite dev` or the built server sees them depends on Nitro and was not tested. In the browser, `import.meta.env.VITE_SUPABASE_URL || process.env[...]` throws `ReferenceError: process is not defined` instead of the friendly message when the `VITE_` variable is missing. The message tells the user to "Connect Supabase in Lovable Cloud" (leftover boilerplate).
- Confidence: speculative (env loading), confirmed (`process` reference and message).

### M23. Bundle and dependency hygiene
- `zod`, `date-fns` and `@hookform/resolvers` are not imported anywhere; 34 more packages (`@radix-ui/*`, `cmdk`, `vaul`, `embla`, `react-day-picker`, `react-hook-form`, `input-otp`, `sonner`, `react-resizable-panels`, `class-variance-authority`) are used only by 44 of 46 `src/components/ui/*` files that nothing imports (only `input.tsx` and `skeleton.tsx` are used; `sidebar.tsx` alone is 744 lines). They are typechecked on every run and bloat install and lockfile (293 KB).
- `dist` (measured, gzip): `index` 173 KB + `routes` 180 KB (includes Recharts and the Supabase client even in demo mode, plus the demo engine in live mode) before lazy chunks `JunctionHologram` 245 KB (three + drei for one OrbitControls scene) and `OpsMap` 46 KB. The charts are not lazy-loaded.
- Confidence: confirmed.

### M24. Docs and comments contradict the code
- `README.md:109` "capped at 30 frames per second" vs `JunctionHologram.tsx:222` `fps={24}`; `README.md:81-86` (see C3); `README.md:24` "every signal" (M5); `DESIGN.md:46` (M12); `DESIGN.md:29` "no middle-dot meta strings" vs `OpsMap.tsx:190` (and ALL-CAPS enum chips in `JunctionList`); `sim-core.ts:35-41` says `DEMAND_SCALE` was lowered because at 1.0 "no signal plan [is] able to help", i.e. the demand was tuned until the adaptive result looked useful (should be stated in the README as a calibration choice); `roadmap.md` is a two-line stale checklist.
- Confidence: confirmed.

---

## LOW

- **L1. `.env` is tracked** (`git ls-files` shows it; `.gitignore` ignores only `*.local`). It contains the original author's project id, URL and publishable key (public by design, but it makes the repo default to someone else's backend and invites a future service key). `git rm --cached .env`, add `.env`.
- **L2. `vite.config.ts` `preview.allowedHosts: true`** disables the host check on the preview server (DNS-rebinding exposure on a dev machine).
- **L3. Third-party calls and privacy.** Every route request sends the start/end coordinates and the user's IP to `router.project-osrm.org` (demo server, "not for production use", rate-limited), and tiles go to `{s}.tile.openstreetmap.org` (`OpsMap.tsx:126`; OSM's tile policy discourages the `{s}` subdomains and asks for an attribution link, while `OpsMap.tsx:127` is plain text `"&copy; OpenStreetMap contributors"` without a link to the copyright page). There is no timeout on `fetchOsrmRoutes` (`routing.ts:175-191`), so a hung request leaves "Finding roads" until the user changes an endpoint. The OSRM error text "could not be reached" (`DirectionsPanel.tsx:131`) is also shown for "NoRoute" and HTTP 429. Google Fonts CSS is render-blocking and third-party (`__root.tsx:100-105`).
- **L4. `decidePhase` freezes on a backward clock step.** `sim-core.ts:143` has no guard for `elapsed < 0`; if the system clock moves back N minutes, every junction holds its phase for N minutes. (My own harness hit this when reusing a process across scenarios.) Clamp `elapsed` at 0 and treat negative as "served".
- **L5. Duplicated logic and constants.** `istDate` re-implemented inline at `PlaceCard.tsx:125`; `INCIDENT_BOOST` duplicated (M9); N,S,E,W order in `demo-engine.ts:36` vs N,E,S,W in `traffic-aggregate.ts:7`; `aggregateCycleRows` defaults `baseline_fixed_sec` to 30 (`traffic-aggregate.ts:37`) while `FIXED_GREEN` is 26 and the DB default is 30.
- **L6. `PlaceCard` "Busiest around"** (`:75-77,125`) takes the first hour of a three-hour plateau (5 pm) while the "Evening peak" shortcut jumps to 6:30 pm. `Attention.tsx` always lists six rows under "Needs attention" even when all are "Flowing". `Attention`'s `onSelect={setSelectedId}` ignores pick mode.
- **L7. Hologram cosmetics.** 18 cars at 0.34 spacing reach z = 3.54, beyond the 3.1 road arm and 3.3 ground disc (`JunctionHologram.tsx:21-24,172-180`); label textures are drawn before the Manrope font loads and never redrawn; R3F logs `THREE.Clock ... deprecated` warnings on each canvas mount.
- **L8. `GlCanvas` never recovers** once `failed` is set (context loss, slow GPU): no retry when roads change or the tab becomes visible again; an interval window that spans a hidden period can count as "slow" once (needs 3 in a row, so low risk).
- **L9. Tooling.** CI (`.github/workflows/build.yml`) runs typecheck, test and build but not lint, and not on feature-branch pushes; `tsconfig.json` does not include `vitest.config.ts`; `vitest` warns that `vite-tsconfig-paths` is redundant; `optimizeDeps.include` is a hand-maintained list (`vite.config.ts:17-30`); `og:image` is missing while `twitter:card` is `summary_large_image` (`index.tsx:66`).
- **L10. Minor semantics.** `traffic.functions.ts:526` `switched` counts rows; `RoadList` shows a constant "ADAPTIVE" badge; `timing_mode` is never anything else; the header's "Updated Ns ago" only refreshes when the dashboard re-renders; ModelPanel's "Discharge" column is saturation flow, "Predicted congestion drop" is delay reduction; `cycle_number` increments per 12 s tick, so the chart's "Cycle #N" is not a signal cycle.
- **L11. CCTV chart x-axis** plots `frame_number` of up to four cameras on one category axis (`CctvPanel.tsx:52`; `demoFetchCctvFeed`, `demo-engine.ts:519-532`), so tick labels such as `f5 f3 f7` are non-monotone.
- **L12. RLS** is `USING (true)` for anon on all nine tables and the view. Fine for simulated data; revisit if real sensor data or operator tables are added. `GRANT ALL ... TO service_role` is redundant for a role that bypasses RLS.

---

## What I could not verify

1. **Live mode end to end.** No Supabase project was available; all `traffic.functions.ts` and `traffic-data.ts` live findings (H3, H4, H5, M19, M22) are from reading. Not checked: that the final migration chain applies cleanly on an empty project, that PostgREST `max-rows` is 1000, that server-side `process.env` is populated from `.env.local` under `vite dev`/`nitro`.
2. **Real OSRM geometry.** I did not call the public OSRM server (third-party download), so "junctions per route" on real road polylines, OSRM response sizes and rate limiting are unmeasured. Only the straight-line fallback was measured.
3. **Anything visual.** The preview on 5181 serves a stale server bundle (assets 404), so layout, contrast, touch targets, the 768 px layout, hydration warnings and the WebGL fallback were judged from code, CSS tokens and arithmetic only (M13, M15, M16, M17, L7 are therefore "likely"). Restart that preview (it has to be done by the owner of the process) before a visual pass.
4. **Screen reader behaviour** (NVDA/VoiceOver) for the combobox and tab list.
5. **Leaflet pick-mode double firing (M1)** was derived from Leaflet and react-leaflet source, not exercised in a browser.
6. **Hydration mismatch risk.** `useState(() => new Date())` at `index.tsx:163` renders different 5-minute-snapped text on server and client if a boundary is crossed between SSR and hydrate; not reproduced.
7. **Geographic accuracy of the 69 coordinates** against real Chennai positions (I only compared them with the migrations and with each other).
8. **CI on GitHub** (npm ci on Linux; the lockfile does contain the linux x64 bindings for rolldown, tailwind oxide and lightningcss).

---

## Top-10 priorities

1. **C1** Add a max-red/aging rule and fix `approachPressure`; add a fairness test (starved arms of 11 to 28 minutes with "Free flowing" next to them).
2. **C2** Recompute "waiting avoided" per elapsed window, keep the sign, label it modelled (currently 5x to 40x too high).
3. **C3** Report adaptive-vs-fixed honestly: signed numbers, daily-mean Webster baseline, say that 31/69 junctions are worse at peak, drop "real traffic engineering" and "run on a fixed plan".
4. **H2** Make `cycleLength = sum(green) + lost` after clamping (delays are off by up to 6.5x for lopsided demand).
5. **H1** Replace the oversaturation branch of `websterDelay` with a monotone, continuous formula and add property tests.
6. **H6** Stop rounding per-tick arrivals and drop the 60 vph floor (night arrival estimates are 18 percent low on average).
7. **H10** Make PlaceCard/Attention/Directions use the same source (live vs forecast) as the map, and make the forecast aware of scenario mode and incident expiry.
8. **H7/H8** Fix the schema before the rubric work: composite FK or drop `junction_id` duplicates, one-green partial unique index, CHECK/enum constraints, incidents/audit tables, DB-side retention; decide what moves into PL/pgSQL.
9. **H3/H4/H5** Before anyone runs live mode: authenticate the two server functions, check write errors, remove the invented fallback junctions and show a real error state.
10. **M1/M2/M3/M4** The four small UX bugs a demo audience will hit: pick-mode overwrites the junction with a pin, forecast time drifts, route selection jumps, "1 min at 0 signals".
