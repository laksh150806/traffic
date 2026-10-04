import { useCallback, useEffect, useRef, useState } from "react";
import { HOSPITALS, stopsForRoute, type Hospital } from "@/lib/priority-run";
import {
  fetchOsrmRoutes,
  haversineM,
  straightLineRoute,
  type LngLat,
  type OsrmRoute,
  type RouteAssessment,
} from "@/lib/routing";
import {
  cancelPriorityRun,
  getEvents,
  getOperatorOverrides,
  getPriorityRun,
  getRoadIncidents,
  startPriorityRun,
  type EngineEvent,
  type OperatorOverride,
  type PriorityRunStatus,
  type RoadIncident,
} from "@/lib/sim-engine";

export type EngineActivity = {
  run: PriorityRunStatus | null;
  overrides: OperatorOverride[];
  incidents: RoadIncident[];
  events: EngineEvent[];
};

const IDLE: EngineActivity = { run: null, overrides: [], incidents: [], events: [] };

/** The hospital closest to a point, as the crow flies. */
export function nearestHospital(lat: number, lng: number): Hospital {
  let best = HOSPITALS[0] as Hospital;
  let bestM = Infinity;
  for (const hospital of HOSPITALS) {
    const d = haversineM([lng, lat], [hospital.lng, hospital.lat]);
    if (d < bestM) {
      bestM = d;
      best = hospital;
    }
  }
  return best;
}

/**
 * Follows the engine's operator overrides, reported road problems, activity log and any priority
 * run, a few times a second. It only changes what it returns when something visible changed, so
 * the map and panels do not redraw for nothing.
 */
export function useEngineActivity(enabled: boolean): EngineActivity {
  const [activity, setActivity] = useState<EngineActivity>(IDLE);
  const lastKey = useRef("");

  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      const now = Date.now();
      const run = getPriorityRun(now);
      const overrides = getOperatorOverrides(now);
      const incidents = getRoadIncidents(now);
      const events = getEvents(8);
      // Coarse on purpose: the vehicle moves a visible step every few metres, a countdown changes
      // once a second, and the rest changes rarely.
      const key = JSON.stringify([
        run && [
          Math.round(run.progressM / 4),
          run.finished,
          run.stops.map((s) => s.phase[0]).join(""),
        ],
        overrides.map((o) => [o.junctionId, o.roadId, o.untilMs, Math.floor(now / 1000)]),
        incidents.map((i) => [i.roadId, i.kind, Math.floor(now / 1000)]),
        events.length,
        events[0]?.atMs,
      ]);
      if (key === lastKey.current) return;
      lastKey.current = key;
      setActivity({ run, overrides, incidents, events });
    };
    read();
    const id = window.setInterval(read, 400);
    return () => window.clearInterval(id);
  }, [enabled]);

  return enabled ? activity : IDLE;
}

export const PACES = [1, 4, 8] as const;

export type RunLauncher = {
  /** How many times faster than real time a new run is shown. */
  pace: number;
  setPace: (pace: number) => void;
  planning: boolean;
  error: string | null;
  sendAmbulance: (from: { lat: number; lng: number; name: string }, hospital: Hospital) => void;
  startWave: (route: RouteAssessment) => void;
  cancel: () => void;
};

/** Starts priority runs in the engine: finds a route for an ambulance, or reuses a chosen trip. */
export function usePriorityRunLauncher(): RunLauncher {
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pace, setPace] = useState<number>(4);
  const paceRef = useRef(pace);
  paceRef.current = pace;
  const token = useRef(0);

  const sendAmbulance = useCallback<RunLauncher["sendAmbulance"]>((from, hospital) => {
    const mine = ++token.current;
    setPlanning(true);
    setError(null);
    const start: LngLat = [from.lng, from.lat];
    const end: LngLat = [hospital.lng, hospital.lat];
    void (async () => {
      let route: OsrmRoute;
      let estimated = false;
      try {
        const routes = await fetchOsrmRoutes(start, end);
        route = routes[0] ?? straightLineRoute(start, end);
      } catch {
        route = straightLineRoute(start, end);
        estimated = true;
      }
      if (mine !== token.current) return;
      const stops = stopsForRoute(route.coordinates);
      startPriorityRun({
        kind: "ambulance",
        label: `Ambulance to ${hospital.name}`,
        coordinates: route.coordinates,
        stops,
        speedFactor: paceRef.current,
      });
      setPlanning(false);
      if (estimated) {
        setError("Road routing was not reachable, so the ambulance follows a straight-line route.");
      }
    })();
  }, []);

  const startWave = useCallback<RunLauncher["startWave"]>((route) => {
    token.current += 1;
    setError(null);
    startPriorityRun({
      kind: "wave",
      label: "Green wave",
      coordinates: route.route.coordinates,
      stops: stopsForRoute(route.route.coordinates),
      speedFactor: paceRef.current,
    });
  }, []);

  const cancel = useCallback(() => {
    token.current += 1;
    setPlanning(false);
    cancelPriorityRun();
  }, []);

  return { pace, setPace, planning, error, sendAmbulance, startWave, cancel };
}
