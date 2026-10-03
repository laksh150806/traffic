# Coursework SQL

PostgreSQL (and PL/pgSQL) queries for the DBMS rubric, written against this project's schema.
They run in the Supabase SQL editor after `supabase/setup.sql`, and the same files run on an
in-process Postgres with one command.

```sh
npm run rubric
```

That applies every migration, runs the five scripts in order, saves what each query returns to
`output/` (paste from there into the report), and fails if any statement errors or any query
comes back empty.

| Rubric item (marks)               | File                       | What is in it                                                                                                                                                                                                                                                 |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subqueries (5)                    | `01_subqueries.sql`        | Q1.1 to Q1.7: scalar in WHERE, IN, NOT IN, in the SELECT list, in FROM (derived tables), row-wise IN, in HAVING                                                                                                                                               |
| Nested and correlated queries (5) | `02_nested_correlated.sql` | Q2.1 and Q2.2 nested three deep; Q2.3 to Q2.9 correlated: aggregate, per-junction average, EXISTS, NOT EXISTS, subqueries in the SELECT list, correlated rank, ALL                                                                                            |
| Views and joins (5)               | `03_views_joins.sql`       | four views (one built on another, one with a window function) and J1 to J8: inner, left, right, full outer, self, cross, and a four-table join with a time condition                                                                                          |
| Trigger, cursor and procedure (5) | `04_plpgsql.sql`           | two triggers (BEFORE validates, AFTER forwards and raises an alert), the app's own `log_phase_change` trigger, a procedure that walks an explicit parameterised cursor, a function returning a refcursor, a procedure with a business rule, a helper function |

`00_sample_data.sql` fills one past day (1 October 2026) with a repeatable history so the
queries have something to chew on and give the same answers every time. It is sample data, not
measurement. `99_cleanup.sql` removes it and every `cw_` object, leaving the application's own
tables, views and functions untouched.

## Running in Supabase

1. Create the project and run `supabase/setup.sql` once.
2. In the SQL editor run `00_sample_data.sql`, then `03_views_joins.sql` (the views are used by
   the later files), then `01`, `02` and `04`. Run each query on its own to see its result.
3. When finished, run `99_cleanup.sql`.

Use a scratch project for this: the live app deletes old history on its own, and the
coursework objects share the `public` schema.

## Notes for the report

- The coursework triggers sit on `cw_sensor_intake`, not on `vehicle_counts`, so the live
  control loop (276 inserts every few seconds) is never slowed down or rejected by them.
- The explicit cursor in `cw_build_daily_report` is deliberate: the same report is one
  `INSERT ... SELECT` with group-bys, and the procedure is written with a cursor because the
  rubric asks for one.
- Query Q2.3 re-runs its inner query once per outer row (about 13,000 times); it is fast
  here because of the `(road_id, recorded_at)` index.
