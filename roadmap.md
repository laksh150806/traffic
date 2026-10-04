# Roadmap

Done

- [x] Vehicle readings labelled as simulated demand (no public Chennai sensor feed)
- [x] Real-time adaptive control with a fairness bound: no approach waits on red for more than
      about two minutes beyond the longest phase
- [x] Maps-style control room: congestion map, forecast for any hour, trip planner
- [x] Honest comparison against a fixed timer tuned to the junction's all-day average, with
      the number of junctions where adaptive is predicted worse shown next to the gain
- [x] Database integrity: composite keys, check constraints, one green per junction,
      a throttle for the control loop, set-based writes, a phase-change trigger, retention in SQL
- [x] Every migration verified on an in-process Postgres (`npm run test:db`)
- [x] Guided tour and a map that opens on the city, with glowing, pulsing jam markers
- [x] Coursework SQL for the DBMS rubric, run and saved by `npm run rubric`
- [x] Replay of fixed timer against adaptive, which exposed and fixed a controller that was
      losing to the timer at the peaks
- [x] Amber and all-red shown at every handover, weekend demand, heavy-rain scenario,
      route pricing per arm
- [x] Keyboard: command palette and Shift+arrow movement between junctions; shareable
      links; CSV export
- [x] Live-mode server functions run against the real schema in tests; authenticated,
      schedulable control endpoint and worker
- [x] Component tests
- [x] Operator hold and reported road problems, ambulance priority run, green wave with a
      time and distance diagram, a city board with an activity feed

Next

- [ ] Calibrate the demand curve on a counted traffic dataset (placeholder curve today)
- [ ] Live speed from a traffic API for the GST Corridor junctions
- [ ] Run live mode against a real Supabase project end to end (needs a project and keys)
- [ ] Turning movements and per-lane delay in route pricing
- [ ] Row-level security and per-user roles if the app ever holds real data
