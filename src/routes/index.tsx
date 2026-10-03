import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Activity, Car, Gauge, MapPin } from "lucide-react";

import { DashboardHeader } from "@/components/traffic/DashboardHeader";
import { JunctionList } from "@/components/traffic/JunctionList";
import { RoadList } from "@/components/traffic/RoadList";
import { CycleChart } from "@/components/traffic/CycleChart";
import { CctvPanel } from "@/components/traffic/CctvPanel";
import { CameraWall } from "@/components/traffic/CameraWall";
import { ModelPanel } from "@/components/traffic/ModelPanel";
import { ScenarioPanel } from "@/components/traffic/ScenarioPanel";
import { CityStage, type StageView } from "@/components/space/CityStage";
import { TiltCard } from "@/components/space/TiltCard";
import { AnimatedNumber } from "@/components/space/AnimatedNumber";
import { Skeleton } from "@/components/ui/skeleton";
import { DATA_MODE } from "@/lib/data-mode";
import { demoAdvance, demoTick } from "@/lib/demo-engine";
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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart Traffic Management | Adaptive signals for Chennai" },
      {
        name: "description",
        content:
          "Adaptive traffic signal control for 69 Chennai junctions: a 3D glass-city view of congestion, a queue model that sets green times, and predicted waiting time against a fixed timer.",
      },
      { property: "og:title", content: "Smart Traffic Management" },
      {
        property: "og:description",
        content:
          "Watch adaptive signal timing cut waiting time against fixed timers, across a glass city.",
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

const LEVEL_STYLE: Record<string, string> = {
  LOW: "border-signal-low/40 bg-signal-low/10 text-signal-low",
  MODERATE: "border-signal-moderate/40 bg-signal-moderate/10 text-signal-moderate",
  HIGH: "border-signal-high/40 bg-signal-high/10 text-signal-high",
};

const LEVEL_LABEL: Record<string, string> = {
  LOW: "Free flowing",
  MODERATE: "Busy",
  HIGH: "Jammed",
};

function Dashboard() {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion() ?? false;
  const liveTick = useServerFn(runTrafficTick);
  const liveAdvance = useServerFn(advanceSignals);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<StageView>("city");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const advancing = useRef(false);

  const junctionsQuery = useQuery({
    queryKey: ["junctions"],
    queryFn: fetchJunctions,
    refetchInterval: 6000,
  });

  const junctions =
    junctionsQuery.data && junctionsQuery.data.length > 0
      ? junctionsQuery.data
      : isDemo
        ? []
        : FALLBACK_JUNCTIONS;

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
  const isLive = activeId !== null && activeId > 0;

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

  // Real-time signal controller: ends and reassigns green phases every 2
  // seconds using the green times the model currently allocates, so timings
  // follow congestion live instead of only being predicted.
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

  const roads = roadsQuery.data ?? [];
  const networkVehicles = junctions.reduce((sum, j) => sum + j.total_vehicle_count, 0);
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
    {
      label: "Avg per approach",
      value: selected?.avg_vehicle_count ?? 0,
      decimals: 1,
      suffix: "",
      icon: Gauge,
    },
    { label: "Junctions", value: junctions.length, decimals: 0, suffix: "", icon: MapPin },
    { label: "Vehicles in network", value: networkVehicles, decimals: 0, suffix: "", icon: Car },
    {
      label: "Predicted wait drop",
      value: networkReduction,
      decimals: 0,
      suffix: "%",
      icon: Activity,
    },
  ];

  const level = selected?.congestion_level ?? "LOW";

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        lastUpdated={lastUpdated}
        onRecalculate={() => void recalculate()}
        busy={busy}
        view={view}
        onViewChange={setView}
        mode={DATA_MODE}
      />

      <main className="grid flex-1 gap-3 p-3 md:p-4 lg:h-[calc(100vh-96px)] lg:flex-none lg:grid-cols-[290px_minmax(0,1fr)_470px] lg:overflow-hidden">
        <div className="order-3 max-h-[460px] lg:order-none lg:max-h-none lg:min-h-0">
          <JunctionList
            junctions={junctions}
            selectedId={activeId}
            onSelect={setSelectedId}
            loading={junctionsQuery.isLoading}
          />
        </div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="order-1 lg:order-none lg:min-h-0"
        >
          <CityStage
            junctions={junctions}
            selectedId={activeId}
            onSelect={setSelectedId}
            loading={junctionsQuery.isLoading}
            view={view}
            top={
              <div className="panel max-w-[320px] px-4 py-3">
                <p className="meta-label">Selected junction</p>
                <h2 className="mt-0.5 text-lg font-semibold leading-snug">
                  {selected?.name ?? "..."}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{selected?.zone ?? ""} zone</span>
                  <span
                    className={`transition-data rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${LEVEL_STYLE[level]}`}
                  >
                    {LEVEL_LABEL[level]}
                  </span>
                </div>
              </div>
            }
            bottom={
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {stats.map((stat) => (
                  <TiltCard key={stat.label} className="panel px-3 py-2.5">
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
                  </TiltCard>
                ))}
              </div>
            }
          />
        </motion.div>

        <div className="scroll-glass order-2 space-y-3 lg:order-none lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          {isDemo ? (
            <ScenarioPanel
              junctionId={isLive ? activeId : null}
              junctionName={selected?.name ?? ""}
              onChange={refreshAll}
            />
          ) : null}

          <section className="panel overflow-hidden">
            <div className="relative h-[250px] border-b border-border">
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
                Each block is a queued vehicle. The glowing head shows who has the green.
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
