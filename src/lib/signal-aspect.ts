/**
 * What a signal head shows, worked out from when each approach last changed state.
 *
 * The traffic model charges every phase LOST_TIME_PER_PHASE seconds in which nothing discharges:
 * the outgoing approach's amber and all-red, and the incoming one's start-up lag. That interval is
 * shown as it would be on the street. When the controller hands the green over at time T:
 *
 *   T to T+3 s    the outgoing approach shows amber, everything else red
 *   T+3 to T+4 s  all red
 *   from T+4 s    the incoming approach shows green
 *
 * Nothing here changes what the model does, only what the heads display.
 */
import { LOST_TIME_PER_PHASE } from "@/lib/traffic-model";

export const AMBER_SEC = 3;

export type Aspect = "GREEN" | "AMBER" | "RED";

export type PhaseRow = { id: number; isGreen: boolean; startedAtMs: number };

/** Aspect of every approach at a junction. `rows` is all four approaches. */
export function junctionAspects(rows: PhaseRow[], nowMs: number): Map<number, Aspect> {
  const result = new Map<number, Aspect>();
  const green = rows.find((row) => row.isGreen);
  const greenAge = green ? (nowMs - green.startedAtMs) / 1000 : Infinity;
  const handover = green !== undefined && greenAge >= 0 && greenAge < LOST_TIME_PER_PHASE;

  for (const row of rows) {
    if (row.isGreen) {
      result.set(row.id, handover ? "RED" : "GREEN");
      continue;
    }
    // The approach that just lost the green was stamped at the same instant as the new green.
    const justLost =
      handover &&
      green !== undefined &&
      Math.abs(row.startedAtMs - green.startedAtMs) <= 1000 &&
      (nowMs - row.startedAtMs) / 1000 < AMBER_SEC;
    result.set(row.id, justLost ? "AMBER" : "RED");
  }
  return result;
}

/** True while the junction is between two greens. */
export function isClearing(rows: PhaseRow[], nowMs: number) {
  const green = rows.find((row) => row.isGreen);
  if (!green) return false;
  const age = (nowMs - green.startedAtMs) / 1000;
  return age >= 0 && age < LOST_TIME_PER_PHASE;
}
