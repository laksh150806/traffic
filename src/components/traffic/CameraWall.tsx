import { useEffect, useMemo, useState } from "react";
import { CameraOff, ScanLine, Video } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { CameraTile, RoadState } from "@/lib/traffic-data";

/** Lanes drawn per approach view. */
const LANES = 3;
/** Vehicles drawn before the view collapses into a "+N more" marker. */
const MAX_DRAWN = 18;

/** Deterministic 0..1 pseudo-random from an integer seed (stable per frame). */
function rand(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function timeAgo(iso: string | null) {
  if (!iso) return "no frames yet";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

type Vehicle = { x: number; y: number; w: number; h: number; conf: number };

function layoutVehicles(roadId: number, frame: number, queue: number, moving: boolean): Vehicle[] {
  const drawn = Math.min(queue, MAX_DRAWN);
  const out: Vehicle[] = [];
  for (let i = 0; i < drawn; i += 1) {
    const seed = roadId * 977 + i * 31;
    const lane = Math.floor(rand(seed) * LANES);
    const laneWidth = 100 / LANES;
    const jitter = rand(seed + 7) * 3 - 1.5;
    const slot = Math.floor(i / LANES);
    // Vehicles stack back from the stop line; during green the queue creeps up.
    const creep = moving ? (frame % 6) * 1.4 : 0;
    const y = 86 - slot * 15.5 - creep;
    if (y < -12) continue;
    out.push({
      x: lane * laneWidth + laneWidth / 2 + jitter,
      y,
      w: laneWidth * 0.58,
      h: 11 + rand(seed + 13) * 3,
      conf: 0.78 + rand(seed + 19) * 0.2,
    });
  }
  return out;
}

function CameraTileView({
  camera,
  road,
  frameTick,
}: {
  camera: CameraTile;
  road: RoadState | undefined;
  frameTick: number;
}) {
  const offline = camera.status !== "ONLINE";
  const queue = road?.vehicle_count ?? 0;
  const green = road?.is_currently_green ?? false;
  const frame = camera.frame_number + frameTick;
  const vehicles = useMemo(
    () => (offline ? [] : layoutVehicles(camera.road_id, frame, queue, green)),
    [offline, camera.road_id, frame, queue, green],
  );
  const hidden = Math.max(0, queue - MAX_DRAWN);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-black/40">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface/60 px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              offline ? "bg-muted" : "bg-signal-high signal-live"
            }`}
          />
          <span className="truncate text-[11px] font-medium">{camera.camera_name}</span>
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            green
              ? "bg-signal-low/15 text-signal-low"
              : "bg-signal-high/15 text-signal-high"
          }`}
        >
          {camera.direction} · {green ? "green" : "red"}
        </span>
      </div>

      <div className="relative aspect-4/3 w-full">
        {offline ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <CameraOff className="h-5 w-5" />
            <span className="text-[11px]">Signal lost</span>
          </div>
        ) : (
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" role="img"
            aria-label={`${camera.direction} approach camera view with ${queue} vehicles detected`}>
            {/* road surface */}
            <rect x="0" y="0" width="100" height="100" fill="oklch(0.22 0.005 285)" />
            <rect x="4" y="0" width="92" height="100" fill="oklch(0.26 0.004 285)" />
            {/* lane markings */}
            {Array.from({ length: LANES - 1 }).map((_, i) => (
              <line
                key={i}
                x1={4 + ((i + 1) * 92) / LANES}
                y1="0"
                x2={4 + ((i + 1) * 92) / LANES}
                y2="88"
                stroke="oklch(0.45 0.01 285)"
                strokeWidth="0.6"
                strokeDasharray="6 5"
              />
            ))}
            {/* stop line */}
            <rect
              x="4"
              y="89"
              width="92"
              height="2.4"
              fill={green ? "var(--signal-low)" : "var(--signal-high)"}
              opacity="0.75"
            />
            {/* vehicles + detection boxes */}
            {vehicles.map((v, i) => (
              <g key={i}>
                <rect
                  x={v.x - v.w / 2}
                  y={v.y - v.h / 2}
                  width={v.w}
                  height={v.h}
                  rx="1.6"
                  fill="oklch(0.62 0.05 250)"
                />
                <rect
                  x={v.x - v.w / 2 - 1}
                  y={v.y - v.h / 2 - 1}
                  width={v.w + 2}
                  height={v.h + 2}
                  rx="1"
                  fill="none"
                  stroke="var(--signal-low)"
                  strokeWidth="0.5"
                />
              </g>
            ))}
            {/* signal head */}
            <rect x="86" y="92" width="6" height="7" rx="1" fill="oklch(0.18 0 0)" />
            <circle
              cx="89"
              cy="95.5"
              r="1.9"
              fill={green ? "var(--signal-low)" : "var(--signal-high)"}
            />
          </svg>
        )}

        {!offline ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-1.5 font-mono text-[9px] text-foreground/80">
            <div className="flex justify-between">
              <span>FRAME {frame}</span>
              <span>{Math.round(camera.confidence_avg * 100)}% CONF</span>
            </div>
            <div className="flex items-end justify-between">
              <span className="rounded bg-black/50 px-1 py-0.5 text-signal-low">
                {queue} detected{hidden > 0 ? ` (+${hidden} beyond view)` : ""}
              </span>
              <span className="rounded bg-black/50 px-1 py-0.5">{timeAgo(camera.analyzed_at)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CameraWall({
  cameras,
  roads,
  loading,
}: {
  cameras: CameraTile[];
  roads: RoadState[];
  loading: boolean;
}) {
  // Slow frame clock so the scenes look like a running feed between refreshes.
  const [frameTick, setFrameTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setFrameTick((f) => f + 1), 900);
    return () => window.clearInterval(id);
  }, []);

  const roadById = useMemo(() => new Map(roads.map((r) => [r.road_id, r])), [roads]);

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Video className="h-4 w-4 text-primary" />
            Approach cameras
          </h2>
          <p className="text-xs text-muted-foreground">
            One camera per approach — the vehicles you see are exactly the count feeding the signal
            model for that direction.
          </p>
        </div>
        <span
          title="There is no public video feed from Chennai's traffic cameras, so each view is drawn from the live demand simulation and model state rather than filmed."
          className="flex items-center gap-1.5 rounded-full border border-signal-moderate/40 bg-signal-moderate/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-signal-moderate"
        >
          <ScanLine className="h-3 w-3" />
          Simulated view
        </span>
      </div>

      {loading ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-4/3 w-full rounded-lg" />
          ))}
        </div>
      ) : cameras.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
          No cameras installed at this junction yet.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {cameras.map((camera) => (
            <CameraTileView
              key={camera.camera_id}
              camera={camera}
              road={roadById.get(camera.road_id)}
              frameTick={frameTick}
            />
          ))}
        </div>
      )}
    </section>
  );
}
