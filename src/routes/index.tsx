import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Activity, Car, Gauge, MapPin, Radio, ServerCrash } from "lucide-react";

import { useEngine } from "@/components/shell/engine";
import { Crosshair } from "@/components/fx/global";
import { MorphText } from "@/components/fx/text";
import { BootSequence } from "@/components/argus/BootSequence";
import { BranchedMenu, type Branch } from "@/components/argus/BranchedMenu";
import { CommandLine, openPalette } from "@/components/argus/CommandLine";
import { ControlLoop } from "@/components/argus/ControlLoop";
import { CoreReadings } from "@/components/argus/CoreReadings";
import { CursorField } from "@/components/argus/CursorField";
import { DayHelix } from "@/components/argus/DayHelix";
import { FolderFloat, type DossierFile } from "@/components/argus/FolderFloat";
import { LiquidGlassDefs } from "@/components/argus/LiquidGlass";
import { SplitFlap } from "@/components/argus/SplitFlap";
import { useGlowBorders } from "@/components/argus/useGlowBorders";
import { JunctionList } from "@/components/traffic/JunctionList";
import { RoadList, type RoadControls } from "@/components/traffic/RoadList";
import { CameraWall } from "@/components/traffic/CameraWall";
import { ModelPanel } from "@/components/traffic/ModelPanel";
import { ScenarioPanel } from "@/components/traffic/ScenarioPanel";
import { Attention } from "@/components/ops/Attention";
import { useForgeEffects } from "@/components/ops/useForgeEffects";
import { DirectionsPanel } from "@/components/ops/DirectionsPanel";
import { CityBoard, type BoardStat } from "@/components/ops/CityBoard";
import { GreenWavePanel } from "@/components/ops/GreenWavePanel";
import { PriorityRunPanel } from "@/components/ops/PriorityRunPanel";
import { useLiveWeather } from "@/components/ops/useLiveWeather";
import { useLiveTraffic } from "@/components/ops/useLiveTraffic";
import { useLiveEta } from "@/components/ops/useLiveEta";
import {
  nearestHospital,
  useEngineActivity,
  usePriorityRunLauncher,
} from "@/components/ops/usePriorityRuns";
import { CommandPalette, type PaletteAction } from "@/components/ops/CommandPalette";
import { TourCaption, TourInvite } from "@/components/ops/GuidedTour";
import { useGuidedTour } from "@/components/ops/useGuidedTour";
import type { Endpoint } from "@/components/ops/OpsMap";
import { PlaceCard } from "@/components/ops/PlaceCard";
import { replayJunction } from "@/lib/replay";
import { csvFileName, networkCsv } from "@/lib/export";
import { decodeView, encodeView } from "@/lib/share";
import { SearchBox } from "@/components/ops/SearchBox";
import { TimeBar } from "@/components/ops/TimeBar";
import { useDirections, type Pricing } from "@/components/ops/useDirections";
import { Skeleton } from "@/components/ui/skeleton";
import { BROWSER_DRIVES_LOOP, DATA_MODE } from "@/lib/data-mode";
import {
  clearOperatorOverride,
  clearRoadIncident,
  getPriorityRun,
  getRealTraffic,
  reportRoadIncident,
  setOperatorOverride,
  simAdvance,
  simTick,
  getIncidentEnds,
  getForecastCapacity,
  getScenarioCapacity,
  getScenarioFactor,
  setScenarioMode,
  type ScenarioMode,
} from "@/lib/sim-engine";
import {
  dayProfile,
  findPeaks,
  istHourOf,
  forecastAsSummary,
  forecastNetwork,
  liveAsForecast,
  minutesUntilIst,
  type ForecastOptions,
  type JunctionForecast,
} from "@/lib/forecast";
import { HOSPITALS } from "@/lib/priority-run";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import { speedHistory } from "@/lib/traffic-history";
import { istClock } from "@/lib/sim-core";
import { advanceSignals, runTrafficTick } from "@/lib/traffic.functions";
import {
  fetchCameraTiles,
  fetchCctvFeed,
  fetchCycleComparison,
  fetchJunctionModel,
  fetchJunctions,
  fetchModelPerformance,
  fetchRoadStates,
  fetchTotalSecondsSaved,
  type JunctionSummary,
} from "@/lib/traffic-data";

const JunctionHologram = lazy(() => import("@/components/space/JunctionHologram"));
const OpsMap = lazy(() => import("@/components/ops/OpsMap"));
// The three charting panels pull in Recharts and sit below the first screen, so they load after it.
const ReplayPanel = lazy(() =>
  import("@/components/ops/ReplayPanel").then((m) => ({ default: m.ReplayPanel })),
);
const CycleChart = lazy(() =>
  import("@/components/traffic/CycleChart").then((m) => ({ default: m.CycleChart })),
);
const CctvPanel = lazy(() =>
  import("@/components/traffic/CctvPanel").then((m) => ({ default: m.CctvPanel })),
);

const PanelFallback = () => <Skeleton className="h-56 w-full rounded-2xl" />;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Control room · SIGNAL OPS" },
      {
        name: "description",
        content:
          "A control-room map of 69 Chennai junctions: see where traffic is jammed now or at any hour ahead, plan a trip with junction delay counted, and watch a queue model set the green times. Traffic is simulated.",
      },
      { property: "og:title", content: "SIGNAL OPS · Chennai adaptive signal control" },
      {
        property: "og:description",
        content:
          "See simulated congestion across Chennai, forecast it, and plan trips with junction delay counted.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

const isSimulated = DATA_MODE === "simulated";

const LEGEND = [
  { label: "Free flowing", cls: "bg-signal-low" },
  { label: "Busy", cls: "bg-signal-moderate" },
  { label: "Jammed", cls: "bg-signal-high" },
];

const NO_JUNCTIONS: JunctionSummary[] = [];
const NO_INCIDENTS: ReadonlyMap<number, number> = new Map();

type Tab = "explore" | "directions";
type BranchId = "watch" | "route" | "rescue" | "scenario" | "forecast" | "network" | "index";

function MapFallback() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      role="status"
      aria-label="Loading the map"
    >
      <span className="signal-live h-24 w-24 rounded-full border border-primary/30" />
    </div>
  );
}

/** Shown instead of invented numbers when the live backend cannot be read. */
function BackendProblem({
  kind,
  message,
  onRetry,
}: {
  kind: "down" | "empty";
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <section role="alert" className="panel max-w-lg space-y-3 p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ServerCrash className="h-5 w-5 text-signal-high" aria-hidden />
          {kind === "down" ? "The live backend is not reachable" : "The database has no junctions"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {kind === "down"
            ? "No traffic data is shown rather than made-up numbers. Check that the Supabase URL and key in .env.local are right and that the project is running."
            : "The connection works but the junction table is empty. Run supabase/setup.sql in the Supabase SQL editor to create the schema and the 69 Chennai junctions."}
        </p>
        <p className="rounded-lg bg-black/20 px-3 py-2 font-mono text-xs text-muted-foreground">
          {message}
        </p>
        <p className="text-xs text-muted-foreground">
          To explore without a database, set VITE_DATA_MODE=simulated and restart.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="glass-button inline-flex min-h-10 items-center px-4 py-2 text-xs font-semibold"
        >
          Try again
        </button>
      </section>
    </main>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion() ?? false;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [branch, setBranch] = useState<BranchId>("watch");
  // The share link and the tour still speak in the old two tabs.
  const tab: Tab = branch === "route" ? "directions" : "explore";
  const setTab = useCallback(
    (next: Tab) =>
      setBranch((b) => (next === "directions" ? "route" : b === "route" ? "watch" : b)),
    [],
  );
  useGlowBorders();
  // The moment being looked at, as an absolute time, so it does not drift as the clock moves on.
  const [targetMs, setTargetMs] = useState<number | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [from, setFrom] = useState<Endpoint | null>(null);
  const [to, setTo] = useState<Endpoint | null>(null);
  const [pick, setPick] = useState<"from" | "to" | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const [showRoadSpeeds, setShowRoadSpeeds] = useState(true);
  const activity = useEngineActivity(isSimulated);
  const launcher = usePriorityRunLauncher();

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const junctionsQuery = useQuery({
    queryKey: ["junctions"],
    queryFn: fetchJunctions,
    refetchInterval: 6000,
  });
  const liveJunctions = junctionsQuery.data ?? NO_JUNCTIONS;

  // Snapped to 5 minutes so "Evening peak" lands on exactly 6:30 pm whatever the minute is now.
  const base = useMemo(() => new Date(Math.floor(clock.getTime() / 300_000) * 300_000), [clock]);
  const offsetMin = targetMs === null ? 0 : Math.round((targetMs - base.getTime()) / 60_000);
  const forecastMs = targetMs !== null && offsetMin > 0 ? targetMs : null;
  const isForecast = forecastMs !== null;
  const at = useMemo(() => (forecastMs === null ? base : new Date(forecastMs)), [forecastMs, base]);
  const setOffset = useCallback(
    (minutes: number) => setTargetMs(minutes <= 0 ? null : base.getTime() + minutes * 60_000),
    [base],
  );
  // Once the chosen moment has passed, we are simply live again.
  useEffect(() => {
    if (targetMs !== null && offsetMin <= 0) setTargetMs(null);
  }, [targetMs, offsetMin]);

  // What the forecast has to assume beyond the clock: a forced scenario and any blocked lanes
  // that will still be blocked at that moment. Read from the engine on each render (cheap) but
  // only changes identity when the facts change.
  const incidentEnds = isSimulated ? getIncidentEnds() : NO_INCIDENTS;
  const incidentKey = [...incidentEnds].map(([id, until]) => `${id}:${until}`).join(",");
  const scenarioFactor = isSimulated && !isForecast ? getScenarioFactor() : undefined;
  const scenarioCapacity = !isSimulated
    ? 1
    : isForecast
      ? getForecastCapacity(at.getTime())
      : getScenarioCapacity();
  const forecastOptions = useMemo<ForecastOptions>(() => {
    const incidents = new Set<number>();
    for (const [id, until] of incidentEnds) if (until > at.getTime()) incidents.add(id);
    return {
      ...(scenarioFactor === undefined ? {} : { factor: scenarioFactor }),
      ...(scenarioCapacity === 1 ? {} : { capacityScale: scenarioCapacity }),
      incidents,
    };
    // incidentEnds is rebuilt every render; incidentKey says whether it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, incidentKey, scenarioFactor, scenarioCapacity]);
  const forecast = useMemo(
    () =>
      new Map<number, JunctionForecast>(
        forecastNetwork(at, forecastOptions).map((f) => [f.junctionId, f]),
      ),
    [at, forecastOptions],
  );
  const pricing = useMemo<Pricing>(
    () => ({
      ...(scenarioFactor === undefined ? {} : { factor: scenarioFactor }),
      ...(scenarioCapacity === 1 ? {} : { capacityScale: scenarioCapacity }),
      incidentEnds,
    }),
    // incidentEnds is rebuilt every render; incidentKey says whether it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incidentKey, scenarioFactor, scenarioCapacity],
  );

  // What the map, lists and cards show: live readings now, the model's forecast for later.
  const junctions = useMemo(
    () => (isForecast ? [...forecast.values()].map(forecastAsSummary) : liveJunctions),
    [isForecast, forecast, liveJunctions],
  );

  // Start on the busiest junction so there is something to look at straight away.
  useEffect(() => {
    if (selectedId !== null || !junctionsQuery.data || junctionsQuery.data.length === 0) return;
    const busiest = [...junctionsQuery.data].sort(
      (a, b) => b.avg_vehicle_count - a.avg_vehicle_count,
    )[0];
    // A functional update: a junction chosen a moment ago (from a shared link) may not be in this
    // render yet, and must not be overwritten by the default.
    if (busiest) setSelectedId((current) => current ?? busiest.junction_id);
  }, [selectedId, junctionsQuery.data]);

  const activeId = selectedId ?? junctions[0]?.junction_id ?? null;
  const selected = junctions.find((j) => j.junction_id === activeId) ?? junctions[0];
  const isLive = activeId !== null && activeId > 0;

  const weekend = istClock(at).weekend;
  const profile = useMemo(() => {
    const index = SEED_JUNCTIONS.findIndex((j) => j.id === selected?.junction_id);
    return index >= 0 ? dayProfile(index, weekend) : [];
  }, [selected?.junction_id, weekend]);

  // keepPreviousData: switching junction keeps the old panels until the new ones arrive,
  // instead of flashing skeletons and tearing down the 3D scene.
  const roadsQuery = useQuery({
    queryKey: ["roads", activeId],
    queryFn: () => fetchRoadStates(activeId as number),
    enabled: isLive,
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
  });
  const cyclesQuery = useQuery({
    queryKey: ["cycles", activeId],
    queryFn: () => fetchCycleComparison(activeId as number),
    enabled: isLive,
    refetchInterval: 6000,
    placeholderData: keepPreviousData,
  });
  const savedQuery = useQuery({
    queryKey: ["saved-total"],
    queryFn: fetchTotalSecondsSaved,
    refetchInterval: 6000,
  });
  const modelQuery = useQuery({
    queryKey: ["model", activeId],
    queryFn: () => fetchJunctionModel(activeId as number),
    enabled: isLive,
    refetchInterval: 6000,
    placeholderData: keepPreviousData,
  });
  const performanceQuery = useQuery({
    queryKey: ["model-performance"],
    queryFn: fetchModelPerformance,
    refetchInterval: 6000,
  });
  const cctvQuery = useQuery({
    queryKey: ["cctv", activeId],
    queryFn: () => fetchCctvFeed(activeId as number),
    enabled: isLive,
    refetchInterval: 6000,
    placeholderData: keepPreviousData,
  });
  const camerasQuery = useQuery({
    queryKey: ["cameras", activeId],
    queryFn: () => fetchCameraTiles(activeId as number),
    enabled: isLive,
    refetchInterval: 6000,
    placeholderData: keepPreviousData,
  });

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const weather = useLiveWeather(isSimulated, refreshAll);
  const liveTraffic = useLiveTraffic(isSimulated, refreshAll);
  const trafficIsLive = liveTraffic.status === "live" || liveTraffic.status === "stale";
  const roadSpeedsOn = trafficIsLive && showRoadSpeeds && !isForecast;
  // A forced scenario (rush hour, overnight) is a made-up day, so real speeds are shown but not used.
  const trafficDriving = getRealTraffic()?.fresh ?? true;

  // The 12 s model loop and 2 s signal controller live in the app shell (EngineProvider).
  const { busy, recalculate } = useEngine();

  const lastUpdated = useMemo(() => {
    const stamps = (junctionsQuery.data ?? [])
      .map((j) => j.last_reading_at)
      .filter((v): v is string => Boolean(v))
      .sort();
    return stamps.length > 0 ? (stamps[stamps.length - 1] as string) : null;
  }, [junctionsQuery.data]);

  const directions = useDirections(from, to, at, pricing);
  // TomTom's own time for the trip, for now only: a forecast hour has no live traffic to ask about.
  const liveEta = useLiveEta(from, to, trafficIsLive && !isForecast);
  const routeIndex = Math.max(
    0,
    directions.assessments.findIndex((a) => a.id === routeId),
  );
  const chooseRoute = useCallback(
    (index: number) => setRouteId(directions.assessments[index]?.id ?? null),
    [directions.assessments],
  );
  useEffect(() => setRouteId(null), [from, to]);

  const endpointOf = (j: JunctionSummary): Endpoint => ({
    lat: j.latitude,
    lng: j.longitude,
    label: j.name,
  });

  const select = (id: number) => {
    const j = junctions.find((item) => item.junction_id === id);
    if (pick && j) {
      if (pick === "from") setFrom(endpointOf(j));
      else setTo(endpointOf(j));
      setPick(null);
      return;
    }
    setSelectedId(id);
  };

  const dropPin = (which: "from" | "to", point: { lat: number; lng: number }) => {
    const endpoint = { ...point, label: "Dropped pin" };
    if (which === "from") setFrom(endpoint);
    else setTo(endpoint);
    setPick(null);
  };

  const directionsFrom = (which: "from" | "to") => {
    if (!selected) return;
    if (which === "from") setFrom(endpointOf(selected));
    else setTo(endpointOf(selected));
    setTab("directions");
  };

  const levelOf = (id: number) => forecast.get(id)?.level ?? "LOW";

  // The guided tour drives the same controls a person would use.
  const tourSnapshot = useCallback(
    (ms: number) => {
      const when = new Date(ms);
      const factor = getScenarioFactor();
      const incidents = new Set<number>();
      for (const [id, until] of getIncidentEnds()) if (until > when.getTime()) incidents.add(id);
      const all = forecastNetwork(when, {
        ...(factor === undefined || ms > base.getTime() + 300_000 ? {} : { factor }),
        capacityScale:
          ms > base.getTime() + 300_000 ? getForecastCapacity(ms) : getScenarioCapacity(),
        incidents,
      });
      const worst = all.reduce<(typeof all)[number] | null>(
        (best, f) => (best === null || f.saturation > best.saturation ? f : best),
        null,
      );
      const seed = worst ? SEED_JUNCTIONS.find((j) => j.id === worst.junctionId) : undefined;
      return {
        jammed: all.filter((f) => f.level === "HIGH").length,
        busy: all.filter((f) => f.level === "MODERATE").length,
        total: all.length,
        worst: seed ? { id: seed.id, name: seed.name, zone: seed.zone } : null,
      };
    },
    [base],
  );
  const tour = useGuidedTour({
    base,
    reducedMotion: reduceMotion,
    setTime: setTargetMs,
    snapshot: tourSnapshot,
    select: (id) => {
      setPick(null);
      setSelectedId(id);
    },
    replay: (junctionId, ms) => {
      const index = SEED_JUNCTIONS.findIndex((j) => j.id === junctionId);
      if (index < 0) return null;
      const factor = getScenarioFactor();
      const r = replayJunction(index, ms, {
        ...(factor === undefined || ms > base.getTime() + 300_000 ? {} : { factor }),
        capacityScale:
          ms > base.getTime() + 300_000 ? getForecastCapacity(ms) : getScenarioCapacity(),
      });
      return {
        waitFixed: r.summary.waitFixed,
        waitAdaptive: r.summary.waitAdaptive,
        percent: r.summary.waitChangePercent,
      };
    },
    showTrip: (fromId, toId) => {
      const a = SEED_JUNCTIONS.find((j) => j.id === fromId);
      const b = SEED_JUNCTIONS.find((j) => j.id === toId);
      if (!a || !b) return;
      setPick(null);
      setFrom({ lat: a.lat, lng: a.lng, label: a.name });
      setTo({ lat: b.lat, lng: b.lng, label: b.name });
      setTab("directions");
    },
    clearTrip: () => {
      setFrom(null);
      setTo(null);
      setTab("explore");
    },
    ...(isSimulated
      ? {
          startAmbulance: () => {
            const start = SEED_JUNCTIONS.find((j) => j.id === 13) ?? SEED_JUNCTIONS[0];
            const hospital = HOSPITALS.find((h) => h.id === "rggh") ?? HOSPITALS[0];
            if (!start || !hospital) return;
            setSelectedId(start.id);
            launcher.sendAmbulance(
              { lat: start.lat, lng: start.lng, name: start.name },
              hospital,
              8,
            );
          },
          runStatus: () => {
            const run = getPriorityRun();
            return run
              ? {
                  passed: run.passed,
                  total: run.stops.length,
                  savedSec: run.savedSec,
                  heldVehicles: run.heldVehicles,
                  finished: run.finished,
                }
              : null;
          },
          stopAmbulance: launcher.cancel,
        }
      : {}),
  });

  // ---- a link to this exact view, kept in the address bar
  const restored = useRef(false);
  useEffect(() => {
    const shared = decodeView(window.location.search, Date.now());
    if (shared.junction !== undefined) setSelectedId(shared.junction);
    if (shared.atMs !== undefined) setTargetMs(shared.atMs);
    if (shared.from) setFrom(shared.from);
    if (shared.to) setTo(shared.to);
    if (shared.tab) setTab(shared.tab);
    restored.current = true;
  }, []);
  const viewQuery = encodeView(
    {
      ...(selectedId === null ? {} : { junction: selectedId }),
      ...(targetMs === null ? {} : { atMs: targetMs }),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      tab,
    },
    Date.now(),
  );
  useEffect(() => {
    if (!restored.current || tour.active) return;
    const url = viewQuery ? `?${viewQuery}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [viewQuery, tour.active]);

  const [shareLabel, setShareLabel] = useState("Share view");
  const shareView = useCallback(() => {
    const url = new URL(window.location.href);
    url.search = viewQuery;
    const done = (text: string) => {
      setShareLabel(text);
      window.setTimeout(() => setShareLabel("Share view"), 2200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url.toString()).then(
        () => done("Link copied"),
        () => window.prompt("Copy this link", url.toString()),
      );
    } else {
      window.prompt("Copy this link", url.toString());
    }
  }, [viewQuery]);

  const exportCsv = useCallback(() => {
    const csv = networkCsv(junctions, forecast, at);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = csvFileName(at);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }, [junctions, forecast, at]);

  // The card shows the running model's own figures for the present, and the forecast for later,
  // so it never disagrees with the panels beneath it.
  const selectedForecast = selected ? forecast.get(selected.junction_id) : undefined;
  const liveCard =
    !isForecast && selected && isLive && modelQuery.data
      ? liveAsForecast(selected, modelQuery.data)
      : undefined;
  const cardForecast = liveCard ?? selectedForecast;

  const roads = roadsQuery.data ?? [];
  const networkVehicles = junctions.reduce((sum, j) => sum + j.total_vehicle_count, 0);
  const jammed = junctions.filter((j) => j.congestion_level === "HIGH").length;
  const perf = performanceQuery.data;
  useForgeEffects(junctions.length ? jammed : null);

  // Signed: negative means the adaptive plan is predicted to wait longer than the fixed timer.
  const waitChange = (() => {
    if (isForecast) {
      const all = [...forecast.values()];
      const flow = all.reduce((sum, f) => sum + f.flowVph, 0);
      const adaptive = all.reduce((sum, f) => sum + f.delayAdaptive * f.flowVph, 0);
      const fixed = all.reduce((sum, f) => sum + f.delayFixed * f.flowVph, 0);
      return {
        percent: fixed > 0 && flow > 0 ? Math.round(((fixed - adaptive) / fixed) * 100) : 0,
        worse: all.filter((f) => f.delayAdaptive > f.delayFixed + 0.5).length,
        total: all.length,
      };
    }
    return {
      percent:
        perf && perf.networkDelayFixed > 0
          ? Math.round(
              ((perf.networkDelayFixed - perf.networkDelayAdaptive) / perf.networkDelayFixed) * 100,
            )
          : 0,
      worse: perf?.junctionsAdaptiveWorse ?? 0,
      total: perf?.junctionsTotal ?? junctions.length,
    };
  })();

  const stats: BoardStat[] = [
    { label: "Junctions jammed", value: jammed, suffix: "", icon: Gauge, note: null },
    {
      label: "Junctions watched",
      value: junctions.length,
      suffix: "",
      icon: MapPin,
      note: null,
    },
    { label: "Vehicles waiting", value: networkVehicles, suffix: "", icon: Car, note: null },
    {
      label: "Wait cut vs fixed timer",
      value: waitChange.percent,
      suffix: "%",
      icon: Activity,
      note:
        waitChange.worse > 0
          ? `Predicted worse at ${waitChange.worse} of ${waitChange.total} junctions`
          : "Predicted no worse at any junction",
    },
  ];

  // What an operator can do at the selected junction. Each action is applied at once instead of
  // waiting for the next 2-second step, then the panels are asked to refresh.
  const roadControls = useMemo<RoadControls | undefined>(() => {
    if (!isSimulated || !isLive || activeId === null) return undefined;
    const apply = () => {
      simAdvance();
      void queryClient.invalidateQueries({ queryKey: ["roads"] });
    };
    return {
      override: activity.overrides.find((o) => o.junctionId === activeId) ?? null,
      incidents: new Map(activity.incidents.map((i) => [i.roadId, i])),
      onGive: (roadId) => {
        setOperatorOverride(activeId, roadId);
        apply();
      },
      onRelease: () => {
        clearOperatorOverride(activeId);
        apply();
      },
      onReport: (roadId, kind) => {
        reportRoadIncident(roadId, kind);
        refreshAll();
      },
      onClearReport: (roadId) => {
        clearRoadIncident(roadId);
        refreshAll();
      },
    };
  }, [isLive, activeId, activity.overrides, activity.incidents, queryClient, refreshAll]);

  const peaks = useMemo(() => findPeaks(base), [base]);
  const paletteActions: PaletteAction[] = [
    ...(isSimulated
      ? [
          {
            id: "tour",
            label: "Take the guided tour",
            keywords: "tour walkthrough present guided",
            run: () => void tour.start(),
          },
        ]
      : []),
    ...(isSimulated
      ? [
          {
            id: "ambulance",
            label: selected ? `Send an ambulance from ${selected.name}` : "Send an ambulance",
            keywords: "emergency hospital priority siren",
            hint: "nearest hospital",
            run: () => {
              if (!selected) return;
              setTab("explore");
              launcher.sendAmbulance(
                { lat: selected.latitude, lng: selected.longitude, name: selected.name },
                nearestHospital(selected.latitude, selected.longitude),
              );
            },
          },
          ...(activity.run
            ? [
                {
                  id: "cancel-run",
                  label: `Cancel: ${activity.run.label}`,
                  keywords: "stop emergency wave priority",
                  run: launcher.cancel,
                },
              ]
            : []),
          ...(directions.assessments[routeIndex] && !activity.run
            ? [
                {
                  id: "green-wave",
                  label: "Run a green wave on the chosen route",
                  keywords: "corridor progressive platoon signals timing",
                  run: () => {
                    const route = directions.assessments[routeIndex];
                    if (route) launcher.startWave(route);
                  },
                },
              ]
            : []),
        ]
      : []),
    {
      id: "peak-am",
      label: "Show the first busy peak ahead",
      keywords: "morning rush peak time",
      hint: "time bar",
      run: () => setOffset(peaks.morning),
    },
    {
      id: "peak-pm",
      label: "Show the second busy peak ahead",
      keywords: "evening rush peak time",
      hint: "time bar",
      run: () => setOffset(peaks.evening),
    },
    { id: "now", label: "Back to now", keywords: "live present", run: () => setOffset(0) },
    { id: "explore", label: "Open Explore", run: () => setTab("explore") },
    {
      id: "directions",
      label: "Open Directions",
      keywords: "trip route plan",
      run: () => setTab("directions"),
    },
    { id: "share", label: "Copy a link to this view", keywords: "share url", run: shareView },
    {
      id: "export",
      label: "Export the network as CSV",
      keywords: "download report data",
      run: exportCsv,
    },
    ...(isSimulated
      ? (
          [
            ["auto", "Scenario: follow the clock", "Time of day"],
            ["rush", "Scenario: rush hour everywhere", "Rush hour"],
            ["night", "Scenario: overnight traffic", "Overnight"],
            ["rain", "Scenario: heavy rain", "Heavy rain"],
          ] as Array<[ScenarioMode, string, string]>
        ).map(([mode, label, hint]) => ({
          id: `scenario-${mode}`,
          label,
          keywords: "scenario demand weather",
          hint,
          run: () => {
            setScenarioMode(mode);
            refreshAll();
          },
        }))
      : []),
  ];

  const backendDown = !isSimulated && junctionsQuery.isError && !junctionsQuery.data;
  const emptyDb = !isSimulated && junctionsQuery.isSuccess && junctionsQuery.data.length === 0;

  // ---- what the eye reads: load, jams, and when fresh readings land
  const all = [...forecast.values()];
  const avgLoad = all.length ? all.reduce((sum, f) => sum + f.saturation, 0) / all.length : 0;
  const busyCount = junctions.filter((j) => j.congestion_level === "MODERATE").length;
  const heat = junctions.length ? jammed / junctions.length : 0;
  const eyeState = {
    aperture: Math.max(0.08, Math.min(1, 1.2 - avgLoad)),
    heat,
    pulseKey: lastUpdated,
  };
  const systemState = tour.active
    ? "TOUR"
    : activity.run && !activity.run.finished
      ? "PRIORITY RUN"
      : busy
        ? "SOLVING"
        : isForecast
          ? "FORECAST"
          : jammed > 0
            ? "WATCHING"
            : "STANDING BY";
  const readings = [
    {
      label: "Jammed",
      value: String(jammed).padStart(2, "0"),
      share: junctions.length ? jammed / junctions.length / 0.3 : 0,
      hot: jammed > 0,
    },
    {
      label: "Busy",
      value: String(busyCount).padStart(2, "0"),
      share: junctions.length ? busyCount / junctions.length : 0,
    },
    {
      label: "Load",
      value: `${Math.round(avgLoad * 100)}%`,
      share: avgLoad,
      note: "Average degree of saturation across all junctions",
    },
    {
      label: "Queued",
      value: networkVehicles.toLocaleString("en-IN"),
      share: networkVehicles / Math.max(1, junctions.length * 60),
      note: "Vehicles waiting at signals, modelled",
    },
    {
      label: "Wait cut",
      value: `${waitChange.percent}%`,
      share: Math.max(0, waitChange.percent) / 50,
      note:
        waitChange.worse > 0
          ? `Adaptive predicted worse at ${waitChange.worse} of ${waitChange.total} junctions`
          : "Adaptive predicted no worse than the fixed timer anywhere",
    },
  ];

  const branches: Branch<BranchId>[] = [
    { id: "watch", label: "Watchlist", reading: String(jammed), hot: jammed > 0 },
    { id: "route", label: "Route", reading: from && to ? "set" : undefined },
    ...(isSimulated
      ? [
          {
            id: "rescue" as const,
            label: "Priority run",
            reading: activity.run
              ? `${activity.run.passed}/${activity.run.stops.length}`
              : undefined,
            hot: Boolean(activity.run && !activity.run.finished),
          },
          { id: "scenario" as const, label: "Scenario" },
        ]
      : []),
    {
      id: "forecast",
      label: "Day spiral",
      reading: isForecast ? `${String(at.getHours()).padStart(2, "0")}h` : "now",
    },
    { id: "network", label: "Network detail" },
    { id: "index", label: "All junctions", reading: String(junctions.length) },
  ];

  const files: DossierFile[] = [
    {
      id: "plan",
      label: "Signal plan",
      tag: roads.length ? `${roads.length} approaches` : undefined,
      render: () => (
        <div>
          <div className="relative h-[220px] border-b border-white/10">
            <ClientOnly fallback={<Skeleton className="h-full w-full rounded-none" />}>
              <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
                {roads.length > 0 ? (
                  <JunctionHologram roads={roads} reducedMotion={reduceMotion} />
                ) : (
                  <Skeleton className="h-full w-full rounded-none" />
                )}
              </Suspense>
            </ClientOnly>
            <p className="meta-label pointer-events-none absolute left-3 top-2">
              Projection: lit blocks moving, dim blocks held
            </p>
          </div>
          <div className="p-3">
            <p className="mb-3 text-xs text-muted-foreground">
              Green time is solved with Webster&apos;s method from each approach&apos;s arrival rate
              and saturation flow. Vehicle readings are simulated; the plan is a real calculation on
              them.
            </p>
            <RoadList
              roads={roads}
              loading={roadsQuery.isLoading && isLive}
              {...(roadControls && !isForecast ? { controls: roadControls } : {})}
            />
          </div>
        </div>
      ),
    },
    ...(selected && isLive
      ? [
          {
            id: "replay",
            label: "Replay",
            tag: "fixed vs adaptive",
            render: () => (
              <Suspense fallback={<PanelFallback />}>
                <ReplayPanel
                  junctionId={selected.junction_id}
                  startMs={at.getTime()}
                  factor={forecastOptions.factor}
                  capacityScale={forecastOptions.capacityScale}
                  blocked={forecastOptions.incidents?.has(selected.junction_id) ?? false}
                />
              </Suspense>
            ),
          },
        ]
      : []),
    {
      id: "model",
      label: "Model",
      tag: cardForecast ? `cycle ${Math.round(cardForecast.cycle)} s` : undefined,
      render: () => (
        <ModelPanel
          approaches={modelQuery.data ?? []}
          performance={performanceQuery.data}
          loading={modelQuery.isLoading && isLive}
        />
      ),
    },
    {
      id: "cycles",
      label: "Cycles",
      render: () => (
        <Suspense fallback={<PanelFallback />}>
          <CycleChart
            data={cyclesQuery.data ?? []}
            saving={savedQuery.data}
            loading={cyclesQuery.isLoading && isLive}
          />
        </Suspense>
      ),
    },
    {
      id: "cameras",
      label: "Cameras",
      tag: "simulated",
      render: () => (
        <CameraWall
          cameras={camerasQuery.data ?? []}
          roads={roads}
          loading={camerasQuery.isLoading && isLive}
        />
      ),
    },
    {
      id: "cctv",
      label: "Counts",
      render: () => (
        <Suspense fallback={<PanelFallback />}>
          <CctvPanel data={cctvQuery.data ?? []} loading={cctvQuery.isLoading && isLive} />
        </Suspense>
      ),
    },
  ];

  const branchPanel = (() => {
    switch (branch) {
      case "route":
        return (
          <>
            <DirectionsPanel
              junctions={junctions}
              from={from}
              to={to}
              onFrom={setFrom}
              onTo={setTo}
              pick={pick}
              onPickMode={setPick}
              assessments={directions.assessments}
              routeIndex={routeIndex}
              onRouteIndex={chooseRoute}
              loading={directions.loading}
              error={directions.error}
              errorKind={directions.errorKind}
              departAt={at}
              departNow={!isForecast}
              levelOf={levelOf}
              liveEta={liveEta}
            />
            {isSimulated && !isForecast ? (
              <GreenWavePanel
                route={directions.assessments[routeIndex]}
                run={activity.run}
                launcher={launcher}
              />
            ) : null}
          </>
        );
      case "rescue":
        return <PriorityRunPanel junction={selected} run={activity.run} launcher={launcher} />;
      case "scenario":
        return (
          <ScenarioPanel
            junctionId={isLive ? activeId : null}
            junctionName={selected?.name ?? ""}
            onChange={refreshAll}
            weather={weather}
          />
        );
      case "forecast":
        return (
          <DayHelix
            base={base}
            options={forecastOptions}
            onPick={setOffset}
            currentHour={istHourOf(at)}
          />
        );
      case "network":
        return (
          <CityBoard
            stats={stats}
            loading={junctionsQuery.isLoading}
            saved={savedQuery.data}
            adaptiveDelay={perf ? Math.round(perf.networkDelayAdaptive) : undefined}
            fixedDelay={perf ? Math.round(perf.networkDelayFixed) : undefined}
            {...(isSimulated ? { activity, weather, liveTraffic, trafficDriving } : {})}
          />
        );
      case "index":
        return (
          <div className="h-[460px]">
            <JunctionList
              junctions={junctions}
              selectedId={activeId}
              onSelect={select}
              loading={junctionsQuery.isLoading}
            />
          </div>
        );
      default:
        return (
          <Attention
            junctions={junctions}
            forecast={forecast}
            selectedId={activeId}
            onSelect={select}
          />
        );
    }
  })();

  return (
    <div className="deck argus ops-deck relative flex min-h-[calc(100vh-82px)] flex-col lg:block lg:h-[calc(100vh-82px)] lg:overflow-hidden">
      <LiquidGlassDefs />
      <BootSequence
        junctions={liveJunctions.length || SEED_JUNCTIONS.length}
        source={isSimulated ? "SIMULATED DEMAND" : "SUPABASE LIVE"}
        ready={liveJunctions.length > 0}
      />
      <CommandPalette
        junctions={junctions}
        actions={paletteActions}
        onPickJunction={(j) => {
          setPick(null);
          setSelectedId(j.junction_id);
        }}
      />

      {backendDown || emptyDb ? (
        <BackendProblem
          kind={backendDown ? "down" : "empty"}
          message={
            junctionsQuery.error instanceof Error
              ? junctionsQuery.error.message
              : "No junctions were returned."
          }
          onRetry={() => void junctionsQuery.refetch()}
        />
      ) : (
        <main className="stage relative flex flex-1 flex-col gap-3 p-3 lg:absolute lg:inset-0 lg:block lg:p-0">
          {/* Centre: the map is the table. */}
          <div className="holo-table @container relative isolate h-[70vh] overflow-hidden rounded-lg border border-white/10 lg:absolute lg:inset-0 lg:h-auto lg:rounded-none lg:border-0">
            <div className="absolute inset-0 z-0">
              <ClientOnly fallback={<MapFallback />}>
                <Suspense fallback={<MapFallback />}>
                  {junctionsQuery.isLoading && !isForecast ? (
                    <MapFallback />
                  ) : (
                    <OpsMap
                      junctions={junctions}
                      selectedId={activeId}
                      onSelect={select}
                      routes={directions.assessments}
                      routeIndex={routeIndex}
                      from={from}
                      to={to}
                      pick={pick}
                      onPick={dropPin}
                      onChooseRoute={chooseRoute}
                      run={activity.run}
                      overrides={activity.overrides}
                      incidents={activity.incidents}
                      trafficOverlay={roadSpeedsOn}
                    />
                  )}
                </Suspense>
              </ClientOnly>
            </div>

            <div className="map-vignette absolute inset-0 z-[5]" aria-hidden />
            <div
              key={lastUpdated ?? "first"}
              className="map-scan absolute inset-0 z-[6]"
              aria-hidden
            />
            <CursorField />
            <Crosshair />
            <div aria-hidden className="ops-map-frame">
              <i className="tl" />
              <i className="tr" />
              <i className="bl" />
              <i className="br" />
            </div>
            <div className="ops-maptools pointer-events-auto absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5">
              <span className="ops-maptag" title={systemState}>
                <MorphText text={`${jammed} JAMMED · ${Math.round(avgLoad * 100)}% LOAD`} />
              </span>
              <button
                type="button"
                className="ops-btn"
                onClick={openPalette}
                title="Command palette (Ctrl+K)"
              >
                Ctrl K
              </button>
              <button type="button" className="ops-btn" onClick={shareView}>
                {shareLabel}
              </button>
              <button type="button" className="ops-btn" onClick={exportCsv}>
                CSV
              </button>
              {isSimulated ? (
                <button type="button" className="ops-btn" onClick={() => void tour.start()}>
                  {tour.active ? "Touring" : "Tour"}
                </button>
              ) : null}
              {lastUpdated ? (
                <span className="ops-maptag hide-sm">
                  {trafficDriving ? "" : "SCENARIO · "}READ{" "}
                  {new Date(lastUpdated).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" })}
                </span>
              ) : null}
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {selected
                ? `Selected ${selected.name}, ${selected.congestion_level.toLowerCase()}`
                : ""}
            </p>

            <ul className="hud pointer-events-auto absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5 text-[0.7rem] text-foreground/90 lg:right-[calc(var(--deck-r)+0.75rem)] lg:top-[64px]">
              {LEGEND.map((item) => (
                <li key={item.label} className="legend-chip">
                  {item.label}
                  <span className={`h-1.5 w-1.5 rounded-full ${item.cls}`} />
                </li>
              ))}
              {trafficIsLive && !isForecast ? (
                <li>
                  <button
                    type="button"
                    aria-pressed={showRoadSpeeds}
                    onClick={() => setShowRoadSpeeds((on) => !on)}
                    title="Colour the roads by how fast real traffic is moving (TomTom)"
                    className={`legend-chip ${showRoadSpeeds ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    Road speeds
                    <Radio className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              ) : null}
            </ul>

            {tour.caption ? (
              <TourCaption caption={tour.caption} onStop={tour.stop} />
            ) : isSimulated && !isForecast && jammed === 0 && !pick && !inviteDismissed ? (
              <TourInvite
                onStart={() => {
                  setInviteDismissed(true);
                  void tour.start();
                }}
              />
            ) : null}

            {pick ? (
              <p
                role="status"
                className="legend-chip pointer-events-none absolute left-1/2 top-[200px] z-10 -translate-x-1/2 px-4 py-1.5 text-xs"
              >
                Click a junction or anywhere on the map to set the{" "}
                {pick === "from" ? "start" : "destination"}
              </p>
            ) : null}

            <div className="hud pointer-events-none absolute inset-x-0 bottom-0 z-10 space-y-2 p-3 lg:left-[var(--deck-l)] lg:right-[var(--deck-r)]">
              <div className="pointer-events-auto mx-auto hidden max-w-[560px] md:block">
                <CommandLine
                  context={(selected?.name ?? "chennai").toLowerCase().replace(/\s+/g, "-")}
                />
              </div>
              <TimeBar now={base} clock={clock} offsetMin={offsetMin} onChange={setOffset} />
            </div>
          </div>

          {/* Left rail: the network, the loop, and the branches. */}
          <div className="slide-left deck-col deck-left rail space-y-5">
            <SearchBox
              junctions={junctions}
              label="Search junctions"
              placeholder="Find a junction or zone"
              onPick={(j) => {
                setSelectedId(j.junction_id);
                setPick(null);
              }}
            />
            <CoreReadings readings={readings} />
            <ControlLoop busy={busy} lastUpdated={lastUpdated} />
            <section aria-label="Tools">
              <h2 className="rail-head">Branches</h2>
              <BranchedMenu
                branches={branches}
                value={branch}
                onChange={setBranch}
                label="What to work on"
              />
            </section>
            <div
              key={branch}
              role="tabpanel"
              id={`panel-${branch}`}
              aria-labelledby={`branch-${branch}`}
              className="branch-panel view-swap space-y-3"
            >
              {branchPanel}
            </div>
          </div>

          {/* Right: the dossier on the junction being watched. */}
          <div className="slide-right deck-col deck-right space-y-3">
            {selected ? (
              <header className="dossier-head">
                <p className="rail-head">
                  Target · {selected.zone}
                  {isForecast ? " · forecast" : " · live"}
                </p>
                <SplitFlap text={selected.name} pad={20} className="flap-lg" />
              </header>
            ) : null}
            {selected && cardForecast ? (
              <PlaceCard
                junction={selected}
                forecast={cardForecast}
                profile={profile}
                onPickHour={(h) => setOffset(minutesUntilIst(base, h, 5))}
                at={at}
                isForecast={isForecast}
                fromLiveModel={liveCard !== undefined}
                roads={roads}
                weekend={weekend}
                onDirectionsFrom={() => directionsFrom("from")}
                onDirectionsTo={() => directionsFrom("to")}
                realFlow={
                  liveTraffic.status === "live" || liveTraffic.status === "stale"
                    ? liveTraffic.snapshot.junctions.find((j) => j.id === selected.junction_id)
                    : undefined
                }
                speeds={trafficIsLive ? speedHistory(selected.junction_id) : []}
                positionVerified={
                  isSimulated
                    ? SEED_JUNCTIONS.find((j) => j.id === selected.junction_id)?.verified
                    : undefined
                }
              />
            ) : (
              <Skeleton className="h-64 w-full rounded-lg" />
            )}

            {isForecast ? (
              <p role="status" className="glass-inset px-3 py-2 text-xs text-muted-foreground">
                The files below show the present moment, not the forecast. Return the time bar to
                Now to match them to the card above.
              </p>
            ) : null}

            <FolderFloat title={selected ? `${selected.name} files` : "Files"} files={files} />
          </div>
        </main>
      )}
    </div>
  );
}
