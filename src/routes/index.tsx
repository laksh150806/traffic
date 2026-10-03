import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Car, Gauge, MapPin } from "lucide-react";

import { DashboardHeader } from "@/components/traffic/DashboardHeader";
import { MapPanel } from "@/components/traffic/MapPanel";
import { JunctionList } from "@/components/traffic/JunctionList";
import { RoadList } from "@/components/traffic/RoadList";
import { CycleChart } from "@/components/traffic/CycleChart";
import { CctvPanel } from "@/components/traffic/CctvPanel";
import { ModelPanel } from "@/components/traffic/ModelPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { advanceSignals, runTrafficTick } from "@/lib/traffic.functions";
import {
  fetchCctvFeed,
  fetchCycleComparison,
  fetchJunctionModel,
  fetchJunctions,
  fetchModelPerformance,
  fetchRoadStates,
  fetchTotalSecondsSaved,
  type JunctionSummary,
} from "@/lib/traffic-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart Traffic Management — Adaptive Signal Control" },
      {
        name: "description",
        content:
          "Adaptive traffic signal control dashboard for Chennai: junction congestion map, queue model, green-time allocation and detection feeds running on simulated demand.",
      },
      { property: "og:title", content: "Smart Traffic Management — Adaptive Signal Control" },
      {
        property: "og:description",
        content:
          "Monitor city junctions in real time and see how adaptive signal timing cuts waiting time versus fixed 30-second timers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

/** Shown only if the backend is briefly unreachable, so the UI never looks dead. */
const FALLBACK_JUNCTIONS: JunctionSummary[] = [
  { junction_id: -1, name: "Tambaram Junction", zone: "GST Corridor", latitude: 12.9249, longitude: 80.1, avg_vehicle_count: 52, total_vehicle_count: 208, congestion_level: "MODERATE", last_reading_at: null },
  { junction_id: -2, name: "Vandalur Junction", zone: "GST Corridor", latitude: 12.893, longitude: 80.081, avg_vehicle_count: 68, total_vehicle_count: 272, congestion_level: "HIGH", last_reading_at: null },
  { junction_id: -3, name: "Chengalpattu Bypass Junction", zone: "GST Corridor", latitude: 12.692, longitude: 79.977, avg_vehicle_count: 24, total_vehicle_count: 96, congestion_level: "LOW", last_reading_at: null },
  { junction_id: -4, name: "SRM Main Gate Junction", zone: "GST Corridor", latitude: 12.823, longitude: 80.045, avg_vehicle_count: 41, total_vehicle_count: 164, congestion_level: "MODERATE", last_reading_at: null },
  { junction_id: -5, name: "Guduvancheri Junction", zone: "GST Corridor", latitude: 12.842, longitude: 80.06, avg_vehicle_count: 33, total_vehicle_count: 132, congestion_level: "MODERATE", last_reading_at: null },
];

const LEVEL_STYLE: Record<string, string> = {
  LOW: "border-signal-low/40 bg-signal-low/10 text-signal-low",
  MODERATE: "border-signal-moderate/40 bg-signal-moderate/10 text-signal-moderate",
  HIGH: "border-signal-high/40 bg-signal-high/10 text-signal-high",
};

function Dashboard() {
  const queryClient = useQueryClient();
  const tick = useServerFn(runTrafficTick);
  const advance = useServerFn(advanceSignals);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const advancing = useRef(false);

  const junctionsQuery = useQuery({
    queryKey: ["junctions"],
    queryFn: fetchJunctions,
    refetchInterval: 6000,
  });

  const junctions =
    junctionsQuery.data && junctionsQuery.data.length > 0 ? junctionsQuery.data : FALLBACK_JUNCTIONS;
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

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const recalculate = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await tick({});
      refreshAll();
    } catch (error) {
      console.error("Traffic tick failed", error);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [tick, refreshAll]);

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
        const result = (await advance({})) as { switched?: number } | undefined;
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
  }, [advance, queryClient]);

  const lastUpdated = useMemo(() => {
    const stamps = (junctionsQuery.data ?? [])
      .map((j) => j.last_reading_at)
      .filter((v): v is string => Boolean(v))
      .sort();
    return stamps.length > 0 ? (stamps[stamps.length - 1] as string) : null;
  }, [junctionsQuery.data]);

  const roads = roadsQuery.data ?? [];
  const networkVehicles = junctions.reduce((sum, j) => sum + j.total_vehicle_count, 0);
  const totalJunctions = junctions.length;
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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <DashboardHeader lastUpdated={lastUpdated} onRecalculate={() => void recalculate()} busy={busy} />

      <div className="grid flex-1 gap-4 p-4 md:px-6 lg:grid-cols-[260px_1.2fr_1fr] lg:gap-0 lg:p-0">
        <div className="lg:h-[calc(100vh-65px)] lg:sticky lg:top-[65px] lg:border-r lg:border-border lg:p-3">
          <JunctionList
            junctions={junctions}
            selectedId={activeId}
            onSelect={setSelectedId}
            loading={junctionsQuery.isLoading}
          />
        </div>

        <div className="lg:h-[calc(100vh-65px)] lg:sticky lg:top-[65px]">
          <MapPanel
            junctions={junctions}
            selectedId={activeId}
            onSelect={setSelectedId}
            loading={junctionsQuery.isLoading}
          />
        </div>

        <div className="space-y-4 lg:max-h-[calc(100vh-65px)] lg:overflow-y-auto lg:p-5">
          <section className="panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="meta-label">Selected junction</p>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <MapPin className="h-4 w-4 text-primary" />
                  {selected?.name ?? "—"}
                </h2>
                <p className="text-xs text-muted-foreground">{selected?.zone ?? ""} zone</p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide transition-data ${
                  LEVEL_STYLE[selected?.congestion_level ?? "LOW"]
                }`}
              >
                {selected?.congestion_level ?? "LOW"} CONGESTION
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Avg / approach", value: selected?.avg_vehicle_count ?? 0, icon: Gauge },
                { label: "Signals in city", value: totalJunctions, icon: MapPin },
                { label: "Network vehicles", value: networkVehicles, icon: Car },
                { label: "Predicted wait drop", value: `${networkReduction}%`, icon: Activity },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-border bg-surface/40 p-3">
                  <p className="meta-label flex items-center gap-1.5">
                    <stat.icon className="h-3 w-3" />
                    {stat.label}
                  </p>
                  {junctionsQuery.isLoading ? (
                    <Skeleton className="mt-1 h-6 w-12" />
                  ) : (
                    <p className="numeric mt-1 text-xl transition-data">{stat.value}</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="text-lg font-semibold">Approaches & live signal plan</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Green time comes from the model: cycle length and splits are solved from the estimated
              arrival rate and discharge capacity of each approach. Vehicle readings come from a
              demand simulator — Chennai has no public sensor feed — while the queue model, timing
              plan and predictions are real traffic engineering.
            </p>
            <RoadList roads={roads} loading={roadsQuery.isLoading && isLive} />
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

          <CctvPanel data={cctvQuery.data ?? []} loading={cctvQuery.isLoading && isLive} />
        </div>
      </div>
    </div>
  );
}
