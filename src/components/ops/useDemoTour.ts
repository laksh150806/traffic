import { useCallback, useEffect, useRef, useState } from "react";
import { findPeaks, formatIstTime, istHourOf, peakLabel } from "@/lib/forecast";

export type TourSnapshot = {
  jammed: number;
  busy: number;
  total: number;
  worst: { id: number; name: string; zone: string } | null;
};

export type TourControls = {
  /** The clock snapped to 5 minutes when the tour starts; the tour works in absolute times from here. */
  base: Date;
  reducedMotion: boolean;
  /** Look at this moment (absolute, ms since epoch), or at the present when null. */
  setTime: (ms: number | null) => void;
  snapshot: (ms: number) => TourSnapshot;
  select: (junctionId: number) => void;
  /** Replay half an hour at a junction from this moment, fixed timer against adaptive. */
  replay: (
    junctionId: number,
    ms: number,
  ) => { waitFixed: number; waitAdaptive: number; percent: number } | null;
  showTrip: (fromId: number, toId: number) => void;
  clearTrip: () => void;
};

export type Caption = {
  time: string;
  phase: string;
  title: string;
  body: string;
  jammed: number | null;
  /** 0 to 1 across the whole tour. */
  progress: number;
};

const TRIP = { from: 1, to: 69 };

const phaseOf = (hour: number) =>
  hour < 5
    ? "Overnight"
    : hour < 7
      ? "Early morning"
      : hour < 11
        ? "Morning rush"
        : hour < 16
          ? "Midday"
          : hour < 20.5
            ? "Evening rush"
            : "Late evening";

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * A guided run of the control room: one simulated day sweeps across the map, the camera stops
 * at the worst junction of each rush hour, then a trip is priced signal by signal. It drives the
 * same controls a person would (time bar, selection, trip planner), so what is shown is real
 * behaviour of the model, only played back quickly.
 */
export function useDemoTour(controls: TourControls) {
  const [caption, setCaption] = useState<Caption | null>(null);
  const token = useRef({ cancelled: false });
  const live = useRef(controls);
  live.current = controls;

  const stop = useCallback(() => {
    token.current.cancelled = true;
    setCaption(null);
    live.current.clearTrip();
    live.current.setTime(null);
  }, []);

  const start = useCallback(async () => {
    token.current.cancelled = true;
    const mine = { cancelled: false };
    token.current = mine;
    const alive = () => !mine.cancelled;
    const c = () => live.current;
    const { base, reducedMotion } = c();

    // The stops are the busiest moments of the next 24 hours, so a weekend tour visits the lunch and
    // evening-outing peaks and a Sunday night one runs into Monday's rush.
    const { morning, evening } = findPeaks(base);
    const step = reducedMotion ? 30 : 5;
    // A little under a day, so the last stop is still inside the time bar's 24 hours after the
    // clock has moved on a few minutes.
    const total = 24 * 60 - 15;
    const progressAt = (offset: number) => 0.1 + 0.62 * (offset / total);
    const at = (offset: number) => new Date(base.getTime() + offset * 60_000);

    c().clearTrip();
    c().setTime(null);
    const now = c().snapshot(base.getTime());
    setCaption({
      time: formatIstTime(base),
      phase: "Right now",
      title: "69 signalised junctions across Chennai",
      body: "Every dot is a junction, coloured by how congested it is. Traffic is simulated; the signal timing maths on top of it is real. Watch a day go by.",
      jammed: now.jammed,
      progress: 0.02,
    });
    await wait(3600);
    if (!alive()) return;

    const peaks = new Set<number>([morning, evening]);
    for (let offset = step; offset <= total; offset += step) {
      if (!alive()) return;
      const when = at(offset);
      c().setTime(when.getTime());
      const snap = c().snapshot(when.getTime());
      const hour = istHourOf(when);
      setCaption({
        time: formatIstTime(when),
        phase: phaseOf(hour),
        title: `${snap.jammed} of ${snap.total} junctions jammed`,
        body:
          snap.jammed === 0
            ? "Roads are flowing. The signals hold longer greens only where cars are waiting."
            : "Queues build on the busiest approaches and the model lengthens their green.",
        jammed: snap.jammed,
        progress: progressAt(offset),
      });
      if (peaks.has(offset) && snap.worst) {
        c().select(snap.worst.id);
        const replay = c().replay(snap.worst.id, when.getTime());
        // Say what the replay found, whichever way it went: it does not win at every junction.
        const replayLine =
          replay && replay.waitFixed > 0
            ? replay.percent >= 3
              ? ` Replaying the next half hour here, a vehicle waits ${replay.waitAdaptive} s with the adaptive controller against ${replay.waitFixed} s on a fixed timer.`
              : replay.percent > -3
                ? ` Replaying the next half hour here, the adaptive controller and a fixed timer wait about the same, ${replay.waitAdaptive} s and ${replay.waitFixed} s.`
                : ` Replaying the next half hour here, a fixed timer does a little better (${replay.waitFixed} s against ${replay.waitAdaptive} s): the adaptive controller does not win at every junction.`
            : "";
        setCaption({
          time: formatIstTime(when),
          phase: peakLabel(hour),
          title: `${snap.worst.name} is the worst of the ${snap.total}`,
          body:
            snap.jammed > 0
              ? `${snap.jammed} junctions are jammed. It is in the ${snap.worst.zone} zone.${replayLine}`
              : `Nothing is jammed even now, but ${snap.busy} junctions are busy. This one is in the ${snap.worst.zone} zone.${replayLine}`,
          jammed: snap.jammed,
          progress: progressAt(offset),
        });
        await wait(reducedMotion ? 2500 : 4600);
        continue;
      }
      const nearPeak = [morning, evening].some((p) => Math.abs(p - offset) <= 45);
      await wait(reducedMotion ? 220 : nearPeak ? 150 : 60);
    }
    if (!alive()) return;

    // Back to the evening rush and a trip across the city.
    c().setTime(at(evening).getTime());
    c().showTrip(TRIP.from, TRIP.to);
    setCaption({
      time: formatIstTime(at(evening)),
      phase: "Trip planner",
      title: `Leaving at ${formatIstTime(at(evening))}, the evening peak`,
      body: "The route is priced junction by junction at the time the vehicle should reach each one, and compared with fixed timers.",
      jammed: c().snapshot(at(evening).getTime()).jammed,
      progress: 0.86,
    });
    await wait(reducedMotion ? 4000 : 7500);
    if (!alive()) return;

    c().clearTrip();
    c().setTime(null);
    setCaption({
      time: formatIstTime(base),
      phase: "Back to now",
      title: "Now try it yourself",
      body: "Drag the time bar, search a junction, plan a trip, or block a lane in the scenario panel and watch the plan adapt.",
      jammed: c().snapshot(base.getTime()).jammed,
      progress: 1,
    });
    await wait(4500);
    if (!alive()) return;
    setCaption(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !token.current.cancelled) stop();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      token.current.cancelled = true;
    };
  }, [stop]);

  return { active: caption !== null, caption, start, stop };
}
