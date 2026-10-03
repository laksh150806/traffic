import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Radio } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { RoadState } from "@/lib/traffic-data";

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

/** Ticking clock so the running green phase counts down smoothly. */
function useSecondsClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function RoadList({ roads, loading }: { roads: RoadState[]; loading: boolean }) {
  const now = useSecondsClock();

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
        const remaining = road.is_currently_green
          ? Math.max(0, road.green_duration_sec - elapsed)
          : null;
        return (
          <div
            key={road.road_id}
            className="rounded-lg border border-border bg-surface/40 p-3 transition-data hover:border-input hover:bg-surface/70"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card ${
                    road.is_currently_green ? "text-signal-low" : "text-muted-foreground"
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
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide ${
                    road.timing_mode === "ADAPTIVE"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-muted text-muted-foreground"
                  }`}
                >
                  {road.timing_mode}
                </span>
                <span
                  className={`h-3 w-3 rounded-full transition-data ${
                    road.is_currently_green
                      ? "bg-signal-low shadow-[0_0_10px_2px_var(--signal-low)] signal-live"
                      : "bg-muted"
                  }`}
                  aria-label={road.is_currently_green ? "Green now" : "Red"}
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="meta-label">Vehicles</p>
                <p className="numeric text-xl transition-data">{road.vehicle_count}</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full transition-data ${tone}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div>
                <p className="meta-label">
                  {remaining !== null ? "Green now" : "Next green"}
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
              {road.source === "CCTV_ANALYSIS" ? "CCTV detection" : "Loop sensor"}
            </p>
          </div>
        );
      })}
    </div>
  );
}
