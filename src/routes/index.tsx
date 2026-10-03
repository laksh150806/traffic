import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Activity, Car, Compass, Gauge, MapPin, Navigation } from "lucide-react";

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
import type { Endpoint } from "@/components/ops/OpsMap";
import { PlaceCard } from "@/components/ops/PlaceCard";
import { SearchBox } from "@/components/ops/SearchBox";
import { TimeBar } from "@/components/ops/TimeBar";
import { useDirections } from "@/components/ops/useDirections";
import { AnimatedNumber } from "@/components/space/AnimatedNumber";
import { Skeleton } from "@/components/ui/skeleton";
import { DATA_MODE } from "@/lib/data-mode";
import { demoAdvance, demoTick, getActiveIncidents } from "@/lib/demo-engine";
import {
  dayProfile,
  forecastAsSummary,
  forecastNetwork,
  type JunctionForecast,
} from "@/lib/forecast";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
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
          "A control-room map of 69 Chennai junctions: see where traffic is jammed now or at any hour ahead, plan a trip with signal delay counted, and watch a queue model set the green times.",
      },
      { property: "og:title", content: "Smart Traffic Management" },
      {
        property: "og:description",
        content:
          "See congestion across Chennai, forecast it, and plan trips with signal delay counted.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const isDemo = DATA_MODE === "demo";

/** Shown only if the live backend is briefly unreachable, so the UI never looks dead. */
const FALLBACK_JUNCTIONS: JunctionSummary[] = [
  {
    junction_id: -1,
    name: "Tambaram Junction",
    zone: "GST Corridor",
    latitude: 12.9249,
    longitude: 80.1,
    avg_vehicle_count: 52,
    total_vehicle_count: 208,
    congestion_level: "MODERATE",
    last_reading_at: null,
  },
  {
    junction_id: -2,
    name: "Vandalur Junction",
    zone: "GST Corridor",
    latitude: 12.893,
    longitude: 80.081,
    avg_vehicle_count: 68,
    total_vehicle_count: 272,
    congestion_level: "HIGH",
    last_reading_at: null,
  },
  {
    junction_id: -3,
    name: "Chengalpattu Bypass Junction",
    zone: "GST Corridor",
    latitude: 12.692,
    longitude: 79.977,
    avg_vehicle_count: 24,
    total_vehicle_count: 96,
    congestion_level: "LOW",
    last_reading_at: null,
  },
  {
    junction_id: -4,
    name: "SRM Main Gate Junction",
    zone: "GST Corridor",
    latitude: 12.823,
    longitude: 80.045,
    avg_vehicle_count: 41,
    total_vehicle_count: 164,
    congestion_level: "MODERATE",
    last_reading_at: null,
  },
  {
    junction_id: -5,
    name: "Guduvancheri Junction",
    zone: "GST Corridor",
    latitude: 12.842,
    longitude: 80.06,
    avg_vehicle_count: 33,
    total_vehicle_count: 132,
    congestion_level: "MODERATE",
    last_reading_at: null,
  },
];

const LEGEND = [
  { label: "Free flowing", cls: "bg-signal-low" },
  { label: "Busy", cls: "bg-signal-moderate" },
  { label: "Jammed", cls: "bg-signal-high" },
];

const INCIDENT_BOOST = 2.6;

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

function Dashboard() {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion() ?? false;
  const liveTick = useServerFn(runTrafficTick);
  const liveAdvance = useServerFn(advanceSignals);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("explore");
  const [offsetMin, setOffsetMin] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [from, setFrom] = useState<Endpoint | null>(null);
  const [to, setTo] = useState<Endpoint | null>(null);
  const [pick, setPick] = useState<"from" | "to" | null>(null);
  const [routeIndex, setRouteIndex] = useState(0);
  const [busy, setBusy] = useState(false);
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

  const liveJunctions = useMemo(
    () =>
      junctionsQuery.data && junctionsQuery.data.length > 0
        ? junctionsQuery.data
        : isDemo
          ? []
          : FALLBACK_JUNCTIONS,
    [junctionsQuery.data],
  );

  // Snapped to 5 minutes so "Evening peak" lands on exactly 6:30 pm whatever the minute is now.
  const base = useMemo(() => new Date(Math.floor(clock.getTime() / 300_000) * 300_000), [clock]);
  const at = useMemo(() => new Date(base.getTime() + offsetMin * 60_000), [base, offsetMin]);
  const isForecast = offsetMin > 0;

  // Blocked lanes in the demo raise demand at that junction; the forecast has to know.
  const boosts = useMemo(
    () => new Map(isDemo ? getActiveIncidents().map((id) => [id, INCIDENT_BOOST] as const) : []),
    // Refreshed whenever junction data refreshes, which is what an incident changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [junctionsQuery.dataUpdatedAt],
  );
  const forecast = useMemo(
    () =>
      new Map<number, JunctionForecast>(forecastNetwork(at, boosts).map((f) => [f.junctionId, f])),
    [at, boosts],
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
    if (busiest) setSelectedId(busiest.junction_id);
  }, [selectedId, junctionsQuery.data]);

  const activeId = selectedId ?? junctions[0]?.junction_id ?? null;
  const selected = junctions.find((j) => j.junction_id === activeId) ?? junctions[0];
  const selectedForecast = selected ? forecast.get(selected.junction_id) : undefined;
  const isLive = activeId !== null && activeId > 0;

  const profile = useMemo(() => {
    const index = SEED_JUNCTIONS.findIndex((j) => j.id === selected?.junction_id);
    return index >= 0 ? dayProfile(index) : [];
  }, [selected?.junction_id]);

  const roadsQuery = useQuery({
    queryKey: ["roads", activeId],
    queryFn: () => fetchRoadStates(activeId as number),
    enabled: isLive,
    refetchInterval: 2000,
  });
  const cyclesQuery = useQuery({
    queryKey: ["cycles", activeId],
    queryFn: () => fetchCycleComparison(activeId as number),
    enabled: isLive,
    refetchInterval: 6000,
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
  });
  const camerasQuery = useQuery({
    queryKey: ["cameras", activeId],
    queryFn: () => fetchCameraTiles(activeId as number),
    enabled: isLive,
    refetchInterval: 6000,
  });

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const recalculate = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (isDemo) demoTick();
      else await liveTick({});
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
        const result = isDemo
          ? demoAdvance()
          : ((await liveAdvance({})) as { switched?: number } | undefined);
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

  const directions = useDirections(from, to, forecast);
  useEffect(() => setRouteIndex(0), [directions.assessments.length, from, to]);

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

  const roads = roadsQuery.data ?? [];
  const networkVehicles = junctions.reduce((sum, j) => sum + j.total_vehicle_count, 0);
  const jammed = junctions.filter((j) => j.congestion_level === "HIGH").length;
  const perf = performanceQuery.data;
  const networkReduction =
    perf && perf.networkDelayFixed > 0
      ? Math.max(
          0,
          Math.round(
            ((perf.networkDelayFixed - perf.networkDelayAdaptive) / perf.networkDelayFixed) * 100,
          ),
        )
      : 0;

  const stats = [
    { label: "Junctions jammed", value: jammed, decimals: 0, suffix: "", icon: Gauge },
    { label: "Junctions watched", value: junctions.length, decimals: 0, suffix: "", icon: MapPin },
    { label: "Vehicles waiting", value: networkVehicles, decimals: 0, suffix: "", icon: Car },
    {
      label: "Predicted wait cut",
      value: networkReduction,
      decimals: 0,
      suffix: "%",
      icon: Activity,
    },
  ];

  const tabs: Array<{ id: Tab; label: string; icon: typeof Compass }> = [
    { id: "explore", label: "Explore", icon: Compass },
    { id: "directions", label: "Directions", icon: Navigation },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        lastUpdated={lastUpdated}
        onRecalculate={() => void recalculate()}
        busy={busy}
        mode={DATA_MODE}
      />

      <main className="grid flex-1 gap-3 p-3 md:p-4 lg:h-[calc(100vh-96px)] lg:flex-none lg:grid-cols-[290px_minmax(0,1fr)_330px] xl:grid-cols-[350px_minmax(0,1fr)_430px] lg:overflow-hidden">
        {/* Left: what to do */}
        <div className="scroll-glass order-2 space-y-3 lg:order-none lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <div role="tablist" aria-label="Mode" className="glass-chip flex gap-1 p-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`transition-data flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium ${
                  tab === id
                    ? "bg-primary/20 text-primary shadow-[0_0_0_1px_oklch(0.82_0.13_205/0.4)]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {tab === "explore" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {stats.map((stat) => (
                  <div key={stat.label} className="glass-inset px-3 py-2.5">
                    <p className="meta-label flex items-center gap-1.5">
                      <stat.icon className="h-3 w-3" />
                      {stat.label}
                    </p>
                    {junctionsQuery.isLoading ? (
                      <Skeleton className="mt-1 h-7 w-14" />
                    ) : (
                      <AnimatedNumber
                        value={stat.value}
                        decimals={stat.decimals}
                        suffix={stat.suffix}
                        className="numeric mt-0.5 block text-2xl"
                      />
                    )}
                  </div>
                ))}
              </div>

              <Attention
                junctions={junctions}
                forecast={forecast}
                selectedId={activeId}
                onSelect={setSelectedId}
              />

              {isDemo ? (
                <ScenarioPanel
                  junctionId={isLive ? activeId : null}
                  junctionName={selected?.name ?? ""}
                  onChange={refreshAll}
                />
              ) : null}

              <details className="glass-inset group">
                <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium">
                  All {junctions.length} junctions
                </summary>
                <div className="h-[420px] p-2">
                  <JunctionList
                    junctions={junctions}
                    selectedId={activeId}
                    onSelect={setSelectedId}
                    loading={junctionsQuery.isLoading}
                  />
                </div>
              </details>
            </>
          ) : (
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
              onRouteIndex={setRouteIndex}
              loading={directions.loading}
              error={directions.error}
              departAt={at}
              levelOf={levelOf}
            />
          )}
        </div>

        {/* Centre: the map */}
        <div className="panel @container relative isolate order-1 h-[520px] overflow-hidden lg:order-none lg:h-full">
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
                    onChooseRoute={setRouteIndex}
                  />
                )}
              </Suspense>
            </ClientOnly>
          </div>

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

          {pick ? (
            <p
              role="status"
              className="glass-chip pointer-events-none absolute left-1/2 top-[68px] z-10 -translate-x-1/2 px-4 py-1.5 text-xs text-primary"
            >
              Click a junction or anywhere on the map to set the{" "}
              {pick === "from" ? "start" : "destination"}
            </p>
          ) : null}

          <div className="hud pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3">
            <TimeBar now={base} offsetMin={offsetMin} onChange={setOffsetMin} />
          </div>
        </div>

        {/* Right: the detail */}
        <div className="scroll-glass order-3 space-y-3 lg:order-none lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          {selected && selectedForecast ? (
            <PlaceCard
              junction={selected}
              forecast={selectedForecast}
              profile={profile}
              at={at}
              isForecast={isForecast}
              roads={roads}
              onDirectionsFrom={() => directionsFrom("from")}
              onDirectionsTo={() => directionsFrom("to")}
            />
          ) : (
            <Skeleton className="h-64 w-full rounded-2xl" />
          )}

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
                Live: each block is a queued vehicle, the glowing head has the green.
              </p>
            </div>
            <div className="p-4">
              <h2 className="text-lg font-semibold">Approaches and live signal plan</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                Green time comes from the model: cycle length and splits are solved from each
                approach's estimated arrival rate and discharge capacity. Vehicle readings come from
                a demand simulator, since Chennai has no public sensor feed. The queue model, timing
                plan and predictions are real traffic engineering.
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
            totalSaved={savedQuery.data ?? 0}
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
    </div>
  );
}
