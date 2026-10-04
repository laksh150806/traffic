import { useMemo } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  Hand,
  Radio,
  TrafficCone,
  TriangleAlert,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TiltCard } from "@/components/space/TiltCard";
import type { RoadState } from "@/lib/traffic-data";
import { junctionAspects } from "@/lib/signal-aspect";
import { useSecondClock } from "@/components/space/useFontsReady";
import { MIN_PHASE_SEC } from "@/lib/sim-core";
import type { OperatorOverride, RoadIncident, RoadIncidentKind } from "@/lib/sim-engine";

const DIRECTION_ICON = {
  NORTH: ArrowUp,
  SOUTH: ArrowDown,
  EAST: ArrowRight,
  WEST: ArrowLeft,
} as const;

function congestionBar(count: number, capacity: number) {
  const pct = Math.min(100, Math.round((count / Math.max(capacity, 1)) * 100));
  const tone = pct >= 55 ? "bg-signal-high" : pct >= 28 ? "bg-signal-moderate" : "bg-signal-low";
  return { pct, tone };
}

/** What an operator can do at this junction, when the app is running its own simulation. */
export type RoadControls = {
  override: OperatorOverride | null;
  incidents: ReadonlyMap<number, RoadIncident>;
  onGive: (roadId: number) => void;
  onRelease: () => void;
  onReport: (roadId: number, kind: RoadIncidentKind) => void;
  onClearReport: (roadId: number) => void;
};

const mmss = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;

export function RoadList({
  roads,
  loading,
  controls,
}: {
  roads: RoadState[];
  loading: boolean;
  controls?: RoadControls;
}) {
  const now = useSecondClock();
  const aspects = useMemo(
    () =>
      junctionAspects(
        roads.map((r) => ({
          id: r.road_id,
          isGreen: r.is_currently_green,
          startedAtMs: r.phase_started_at ? Date.parse(r.phase_started_at) : 0,
        })),
        now,
      ),
    [roads, now],
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (roads.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
        No approaches configured for this junction yet.
      </p>
    );
  }

  const override = controls?.override ?? null;
  const overrideLeft = override ? Math.max(0, Math.round((override.untilMs - now) / 1000)) : 0;
  const heldRoad = override ? roads.find((r) => r.road_id === override.roadId) : undefined;
  const running = roads.find((r) => r.is_currently_green);
  const runningFor = running?.phase_started_at
    ? Math.max(0, (now - new Date(running.phase_started_at).getTime()) / 1000)
    : Infinity;

  return (
    <div className="space-y-3">
      {override && heldRoad ? (
        <div
          role="status"
          className="glass-inset flex flex-wrap items-center justify-between gap-2 border border-signal-moderate/50 px-3 py-2"
        >
          <p className="flex items-center gap-2 text-xs">
            <Hand className="h-4 w-4 shrink-0 text-signal-moderate" aria-hidden />
            <span>
              <span className="font-medium">Operator override.</span> {heldRoad.direction} holds the
              green for <span className="numeric">{mmss(overrideLeft)}</span>, then the controller
              takes over again.
            </span>
          </p>
          <button
            type="button"
            onClick={controls?.onRelease}
            className="glass-chip transition-data min-h-8 px-3 text-[11px] font-medium text-foreground hover:text-primary"
          >
            Release now
          </button>
        </div>
      ) : null}
      {roads.map((road) => {
        const Icon = DIRECTION_ICON[road.direction as keyof typeof DIRECTION_ICON] ?? Radio;
        const { pct, tone } = congestionBar(road.vehicle_count, road.max_capacity);
        const greenPct = Math.min(100, Math.round((road.green_duration_sec / 90) * 100));
        const elapsed = road.phase_started_at
          ? Math.max(0, Math.floor((now - new Date(road.phase_started_at).getTime()) / 1000))
          : 0;
        const aspect = aspects.get(road.road_id) ?? "RED";
        // The green was handed over but the clearance (amber, all red) is still running.
        const starting = road.is_currently_green && aspect === "RED";
        const remaining =
          aspect === "GREEN" ? Math.max(0, road.green_duration_sec - elapsed) : null;
        const held = override?.roadId === road.road_id;
        const report = controls?.incidents.get(road.road_id);
        const reportLeft = report ? Math.max(0, Math.round((report.untilMs - now) / 1000)) : 0;
        // A new green is not given while the running one is inside its safety floor.
        const cannotYet = !road.is_currently_green && runningFor < MIN_PHASE_SEC;
        return (
          <TiltCard
            key={road.road_id}
            max={3}
            className={`glass-inset transition-data p-3 ${
              aspect === "GREEN"
                ? "shadow-[0_0_28px_-10px_var(--signal-low)]"
                : aspect === "AMBER"
                  ? "shadow-[0_0_28px_-10px_var(--signal-moderate)]"
                  : ""
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card ${
                    aspect === "GREEN"
                      ? "text-signal-low"
                      : aspect === "AMBER"
                        ? "text-signal-moderate"
                        : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium leading-tight">{road.direction}</p>
                  <p className="text-xs text-muted-foreground leading-tight">
                    {road.road_name ?? "Approach"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    road.timing_mode === "ADAPTIVE"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-muted text-muted-foreground"
                  }`}
                >
                  {road.timing_mode}
                </span>
                <span
                  className={`h-3 w-3 rounded-full transition-data ${
                    aspect === "GREEN"
                      ? "bg-signal-low shadow-[0_0_10px_2px_var(--signal-low)] signal-live"
                      : aspect === "AMBER"
                        ? "bg-signal-moderate shadow-[0_0_10px_2px_var(--signal-moderate)]"
                        : starting
                          ? "bg-signal-high/60"
                          : "bg-muted"
                  }`}
                  role="img"
                  aria-label={
                    aspect === "GREEN"
                      ? "Green now"
                      : aspect === "AMBER"
                        ? "Amber"
                        : starting
                          ? "Red, green is about to start"
                          : "Red"
                  }
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="meta-label">Vehicles</p>
                <p className="numeric text-xl transition-data">{road.vehicle_count}</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-data ${tone}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div>
                <p className="meta-label">
                  {remaining !== null ? "Green now" : starting ? "Green starting" : "Next green"}
                </p>
                <p className="numeric text-xl text-primary transition-data">
                  {road.green_duration_sec}
                  <span className="ml-0.5 text-xs text-muted-foreground">s</span>
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-data ${
                      remaining !== null ? "bg-signal-low" : "bg-primary"
                    }`}
                    style={{
                      width: `${
                        remaining !== null
                          ? Math.round((remaining / Math.max(road.green_duration_sec, 1)) * 100)
                          : greenPct
                      }%`,
                    }}
                  />
                </div>
                {remaining !== null ? (
                  <p className="mt-1 numeric text-[11px] text-signal-low">{remaining}s remaining</p>
                ) : null}
              </div>
            </div>

            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {road.source === "CCTV_ANALYSIS" ? (
                <Camera className="h-3 w-3" />
              ) : (
                <Radio className="h-3 w-3" />
              )}
              {road.source === "CCTV_ANALYSIS" ? "CCTV detection" : "Simulated sensor"}
            </p>

            {controls ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
                <button
                  type="button"
                  aria-pressed={held}
                  onClick={() => (held ? controls.onRelease() : controls.onGive(road.road_id))}
                  title={
                    held
                      ? "Hand this junction back to the controller"
                      : cannotYet
                        ? `The running green is held for at least ${MIN_PHASE_SEC} s before it can be handed over`
                        : "Give this approach the green for a minute"
                  }
                  className={`transition-data inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium ${
                    held
                      ? "border-signal-moderate/60 bg-signal-moderate/15 text-signal-moderate"
                      : "border-border bg-card/40 text-foreground hover:border-primary/50 hover:text-primary"
                  }`}
                >
                  <Hand className="h-3 w-3" aria-hidden />
                  {held ? "Holding green, release" : "Give green"}
                </button>
                {report ? (
                  <button
                    type="button"
                    onClick={() => controls.onClearReport(road.road_id)}
                    className="transition-data inline-flex min-h-8 items-center gap-1.5 rounded-full border border-signal-high/50 bg-signal-high/10 px-3 text-[11px] font-medium text-signal-high"
                  >
                    {report.kind === "accident" ? (
                      <TriangleAlert className="h-3 w-3" aria-hidden />
                    ) : (
                      <TrafficCone className="h-3 w-3" aria-hidden />
                    )}
                    {report.kind === "accident" ? "Accident" : "Road works"} {mmss(reportLeft)},
                    clear
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => controls.onReport(road.road_id, "accident")}
                      className="glass-chip transition-data inline-flex min-h-8 items-center gap-1.5 px-3 text-[11px] text-muted-foreground hover:text-signal-high"
                    >
                      <TriangleAlert className="h-3 w-3" aria-hidden />
                      Report accident
                    </button>
                    <button
                      type="button"
                      onClick={() => controls.onReport(road.road_id, "works")}
                      className="glass-chip transition-data inline-flex min-h-8 items-center gap-1.5 px-3 text-[11px] text-muted-foreground hover:text-signal-moderate"
                    >
                      <TrafficCone className="h-3 w-3" aria-hidden />
                      Road works
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </TiltCard>
        );
      })}
    </div>
  );
}
