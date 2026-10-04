import { useMemo } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Radio } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TiltCard } from "@/components/space/TiltCard";
import type { RoadState } from "@/lib/traffic-data";
import { junctionAspects } from "@/lib/signal-aspect";
import { useSecondClock } from "@/components/space/useFontsReady";

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

export function RoadList({ roads, loading }: { roads: RoadState[]; loading: boolean }) {
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

  return (
    <div className="space-y-3">
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
          </TiltCard>
        );
      })}
    </div>
  );
}
