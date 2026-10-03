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
- [x] Guided demo tour and a map that opens on the city, with glowing, pulsing jam markers

Next

- [ ] Calibrate the demand curve on a counted traffic dataset (placeholder curve today)
- [ ] Live speed from a traffic API for the GST Corridor junctions
- [ ] Coursework SQL: subqueries, correlated queries, views and joins, cursor and procedure
      reports over the history tables
- [ ] Run live mode against a real Supabase project end to end
