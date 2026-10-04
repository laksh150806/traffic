import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useReducedMotion } from "motion/react";
import {
  Activity,
  Car,
  ChevronDown,
  Compass,
  Gauge,
  MapPin,
  Navigation,
  ServerCrash,
} from "lucide-react";

import { DashboardHeader } from "@/components/traffic/DashboardHeader";
import { JunctionList } from "@/components/traffic/JunctionList";
import { RoadList } from "@/components/traffic/RoadList";
import { CycleChart } from "@/components/traffic/CycleChart";
import { CctvPanel } from "@/components/traffic/CctvPanel";
import { CameraWall } from "@/components/traffic/CameraWall";
import { ModelPanel } from "@/components/traffic/ModelPanel";
import { ScenarioPanel } from "@/components/traffic/ScenarioPanel";
import { Attention } from "@/components/ops/Attention";
import { DirectionsPanel } from "@/components/ops/DirectionsPanel";
import { CommandPalette, type PaletteAction } from "@/components/ops/CommandPalette";
import { TourCaption, TourInvite } from "@/components/ops/GuidedTour";
import { useGuidedTour } from "@/components/ops/useGuidedTour";
import type { Endpoint } from "@/components/ops/OpsMap";
import { PlaceCard } from "@/components/ops/PlaceCard";
import { ReplayPanel } from "@/components/ops/ReplayPanel";
import { replayJunction } from "@/lib/replay";
import { csvFileName, networkCsv } from "@/lib/export";
import { decodeView, encodeView } from "@/lib/share";
import { SearchBox } from "@/components/ops/SearchBox";
import { TimeBar } from "@/components/ops/TimeBar";
import { useDirections, type Pricing } from "@/components/ops/useDirections";
import { AnimatedNumber } from "@/components/space/AnimatedNumber";
import { Skeleton } from "@/components/ui/skeleton";
import { BROWSER_DRIVES_LOOP, DATA_MODE } from "@/lib/data-mode";
import {
  simAdvance,
  simTick,
  getIncidentEnds,
  getScenarioCapacity,
  getScenarioFactor,
  setScenarioMode,
  type ScenarioMode,
} from "@/lib/sim-engine";
import {
  dayProfile,
  findPeaks,
  forecastAsSummary,
  forecastNetwork,
  liveAsForecast,
  type ForecastOptions,
  type JunctionForecast,
} from "@/lib/forecast";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart Traffic Management | Adaptive signals for Chennai" },
      {
        name: "description",
        content:
          "A control-room map of 69 Chennai junctions: see where traffic is jammed now or at any hour ahead, plan a trip with junction delay counted, and watch a queue model set the green times. Traffic is simulated.",
      },
      { property: "og:title", content: "Smart Traffic Management" },
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
  const liveTick = useServerFn(runTrafficTick);
  const liveAdvance = useServerFn(advanceSignals);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("explore");
  // The moment being looked at, as an absolute time, so it does not drift as the clock moves on.
  const [targetMs, setTargetMs] = useState<number | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [from, setFrom] = useState<Endpoint | null>(null);
  const [to, setTo] = useState<Endpoint | null>(null);
  const [pick, setPick] = useState<"from" | "to" | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const running = useRef(false);
  const advancing = useRef(false);

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
  const scenarioCapacity = isSimulated && !isForecast ? getScenarioCapacity() : 1;
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

  const recalculate = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (isSimulated) simTick();
      else if (BROWSER_DRIVES_LOOP) await liveTick({});
      refreshAll();
    } catch (error) {
      console.error("Traffic tick failed", error);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [liveTick, refreshAll]);

  // Simulated sensor + model loop: re-solves the network every 12 seconds.
  useEffect(() => {
    void recalculate();
    const id = window.setInterval(() => void recalculate(), 12000);
    return () => window.clearInterval(id);
  }, [recalculate]);

  // Real-time signal controller: ends and reassigns green phases every 2 seconds.
  useEffect(() => {
    const run = async () => {
      if (advancing.current) return;
      advancing.current = true;
      try {
        const result = isSimulated
          ? simAdvance()
          : BROWSER_DRIVES_LOOP
            ? ((await liveAdvance({})) as { switched?: number } | undefined)
            : undefined;
        if (result?.switched) {
          void queryClient.invalidateQueries({ queryKey: ["roads"] });
        }
      } catch (error) {
        console.error("Signal controller failed", error);
      } finally {
        advancing.current = false;
      }
    };
    void run();
    const id = window.setInterval(() => void run(), 2000);
    return () => window.clearInterval(id);
  }, [liveAdvance, queryClient]);

  const lastUpdated = useMemo(() => {
    const stamps = (junctionsQuery.data ?? [])
      .map((j) => j.last_reading_at)
      .filter((v): v is string => Boolean(v))
      .sort();
    return stamps.length > 0 ? (stamps[stamps.length - 1] as string) : null;
  }, [junctionsQuery.data]);

  const directions = useDirections(from, to, at, pricing);
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
        ...(ms > base.getTime() + 300_000 ? {} : { capacityScale: getScenarioCapacity() }),
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
        ...(ms > base.getTime() + 300_000 ? {} : { capacityScale: getScenarioCapacity() }),
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

  const stats = [
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

  const tabs: Array<{ id: Tab; label: string; icon: typeof Compass }> = [
    { id: "explore", label: "Explore", icon: Compass },
    { id: "directions", label: "Directions", icon: Navigation },
  ];
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next: Tab = tab === "explore" ? "directions" : "explore";
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

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

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <DashboardHeader
        lastUpdated={lastUpdated}
        onRecalculate={() => void recalculate()}
        busy={busy}
        mode={DATA_MODE}
        {...(isSimulated ? { onStartTour: () => void tour.start(), tourPlaying: tour.active } : {})}
        onShare={shareView}
        shareLabel={shareLabel}
        onExport={exportCsv}
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
        <main className="grid flex-1 gap-3 p-3 md:p-4 lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_300px] lg:grid-rows-1 lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)_380px] 2xl:grid-cols-[350px_minmax(0,1fr)_430px]">
          {/* Centre: the map. First in reading order so the search box and map controls come first. */}
          <div className="panel @container relative isolate h-[520px] overflow-hidden lg:col-start-2 lg:row-start-1 lg:h-full">
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
                    />
                  )}
                </Suspense>
              </ClientOnly>
            </div>

            <div className="map-vignette absolute inset-0 z-[5]" aria-hidden />
            <p className="sr-only" role="status" aria-live="polite">
              {selected
                ? `Selected ${selected.name}, ${selected.congestion_level.toLowerCase()}`
                : ""}
            </p>

            <div className="hud pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="pointer-events-auto w-full max-w-[340px]">
                <SearchBox
                  junctions={junctions}
                  label="Search junctions"
                  placeholder="Search a junction or zone"
                  onPick={(j) => {
                    setSelectedId(j.junction_id);
                    setPick(null);
                  }}
                />
              </div>
              <ul className="pointer-events-auto flex flex-wrap gap-2 text-xs text-foreground/90">
                {LEGEND.map((item) => (
                  <li key={item.label} className="glass-chip flex items-center gap-1.5 px-3 py-1.5">
                    <span className={`h-2 w-2 rounded-full ${item.cls}`} />
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>

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
                className="glass-chip pointer-events-none absolute left-1/2 top-[76px] z-10 -translate-x-1/2 px-4 py-1.5 text-xs text-primary"
              >
                Click a junction or anywhere on the map to set the{" "}
                {pick === "from" ? "start" : "destination"}
              </p>
            ) : null}

            <div className="hud pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3">
              <TimeBar now={base} clock={clock} offsetMin={offsetMin} onChange={setOffset} />
            </div>
          </div>

          {/* Left: what to do */}
          <div className="scroll-glass space-y-3 lg:col-start-1 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <div
              role="tablist"
              aria-label="Mode"
              onKeyDown={onTabKey}
              className="glass-chip flex gap-1 p-1"
            >
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  id={`tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls={`panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => setTab(id)}
                  className={`transition-data flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium ${
                    tab === id
                      ? "bg-primary/20 text-primary shadow-[0_0_0_1px_oklch(0.82_0.13_205/0.4)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>

            {tab === "explore" ? (
              <div
                role="tabpanel"
                id="panel-explore"
                aria-labelledby="tab-explore"
                className="space-y-3"
              >
                <div className="grid grid-cols-2 gap-2">
                  {stats.map((stat) => (
                    <div key={stat.label} className="glass-inset px-3 py-2.5">
                      <p className="meta-label flex items-center gap-1.5">
                        <stat.icon className="h-3 w-3" aria-hidden />
                        {stat.label}
                      </p>
                      {junctionsQuery.isLoading ? (
                        <Skeleton className="mt-1 h-7 w-14" />
                      ) : (
                        <AnimatedNumber
                          value={stat.value}
                          decimals={0}
                          suffix={stat.suffix}
                          className="numeric mt-0.5 block text-2xl"
                        />
                      )}
                      {stat.note ? (
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {stat.note}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>

                <Attention
                  junctions={junctions}
                  forecast={forecast}
                  selectedId={activeId}
                  onSelect={select}
                />

                {isSimulated ? (
                  <ScenarioPanel
                    junctionId={isLive ? activeId : null}
                    junctionName={selected?.name ?? ""}
                    onChange={refreshAll}
                  />
                ) : null}

                <details className="glass-inset group">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium">
                    All {junctions.length} junctions
                    <ChevronDown
                      className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <div className="h-[420px] p-2">
                    <JunctionList
                      junctions={junctions}
                      selectedId={activeId}
                      onSelect={select}
                      loading={junctionsQuery.isLoading}
                    />
                  </div>
                </details>
              </div>
            ) : (
              <div
                role="tabpanel"
                id="panel-directions"
                aria-labelledby="tab-directions"
                className="space-y-3"
              >
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
                />
              </div>
            )}
          </div>

          {/* Right: the detail */}
          <div className="scroll-glass space-y-3 lg:col-start-3 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            {selected && cardForecast ? (
              <PlaceCard
                junction={selected}
                forecast={cardForecast}
                profile={profile}
                at={at}
                isForecast={isForecast}
                fromLiveModel={liveCard !== undefined}
                roads={roads}
                weekend={weekend}
                onDirectionsFrom={() => directionsFrom("from")}
                onDirectionsTo={() => directionsFrom("to")}
              />
            ) : (
              <Skeleton className="h-64 w-full rounded-2xl" />
            )}

            {isForecast ? (
              <p role="status" className="glass-inset px-3 py-2 text-xs text-muted-foreground">
                The panels below show the present moment, not the forecast. Return the time bar to
                Now to match them to the card above.
              </p>
            ) : null}

            {selected && isLive ? (
              <ReplayPanel
                junctionId={selected.junction_id}
                startMs={at.getTime()}
                factor={forecastOptions.factor}
                capacityScale={forecastOptions.capacityScale}
                blocked={forecastOptions.incidents?.has(selected.junction_id) ?? false}
              />
            ) : null}

            <section className="panel overflow-hidden">
              <div className="relative h-[230px] border-b border-border">
                <ClientOnly fallback={<Skeleton className="h-full w-full rounded-none" />}>
                  <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
                    {roads.length > 0 ? (
                      <JunctionHologram roads={roads} reducedMotion={reduceMotion} />
                    ) : (
                      <Skeleton className="h-full w-full rounded-none" />
                    )}
                  </Suspense>
                </ClientOnly>
                <p className="pointer-events-none absolute left-4 top-3 text-xs text-muted-foreground">
                  Now: each block is a queued vehicle, the glowing head has the green.
                </p>
              </div>
              <div className="p-4">
                <h2 className="text-lg font-semibold">Approaches and live signal plan</h2>
                <p className="mb-4 text-xs text-muted-foreground">
                  Green time comes from the model: cycle length and splits are solved with
                  Webster&apos;s method from each approach&apos;s estimated arrival rate and
                  saturation flow. Vehicle readings come from a demand simulator, since Chennai has
                  no public sensor feed, so the plans and predictions are real calculations on
                  simulated traffic.
                </p>
                <RoadList roads={roads} loading={roadsQuery.isLoading && isLive} />
              </div>
            </section>

            <ModelPanel
              approaches={modelQuery.data ?? []}
              performance={performanceQuery.data}
              loading={modelQuery.isLoading && isLive}
            />
            <CycleChart
              data={cyclesQuery.data ?? []}
              saving={savedQuery.data}
              loading={cyclesQuery.isLoading && isLive}
            />
            <CameraWall
              cameras={camerasQuery.data ?? []}
              roads={roads}
              loading={camerasQuery.isLoading && isLive}
            />
            <CctvPanel data={cctvQuery.data ?? []} loading={cctvQuery.isLoading && isLive} />
          </div>
        </main>
      )}
    </div>
  );
}
