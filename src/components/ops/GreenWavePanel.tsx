import { useMemo } from "react";
import { Waves } from "lucide-react";
import { RUN_SETTINGS, projectDrive, stopsForRoute, type Projection } from "@/lib/priority-run";
import { formatKm, type RouteAssessment } from "@/lib/routing";
import { getSignalPlans, type PriorityRunStatus } from "@/lib/sim-engine";
import { useSecondClock } from "@/components/space/useFontsReady";
import { RunStatus } from "@/components/ops/RunStatus";
import { PaceSelect } from "@/components/ops/PaceSelect";
import type { RunLauncher } from "@/components/ops/usePriorityRuns";

const W = 340;
const H = 190;
const LEFT = 84;
const TOP = 10;
const BOTTOM = 22;
const RIGHT = 8;

const short = (name: string) => (name.length > 13 ? `${name.slice(0, 12)}…` : name);

/**
 * Time on the across, distance along the route down the side. Each signal is a row: green where
 * it will show green, with the vehicle's track drawn over it. A flat stretch of the track is a
 * stop at a red light.
 */
export function TimeSpaceDiagram({ projection }: { projection: Projection }) {
  const { rows, track, horizonSec } = projection;
  const maxM = Math.max(...rows.map((r) => r.stop.alongM), 1);
  const x = (t: number) => LEFT + (Math.min(t, horizonSec) / horizonSec) * (W - LEFT - RIGHT);
  const y = (d: number) => TOP + (d / maxM) * (H - TOP - BOTTOM);
  const step = horizonSec > 480 ? 180 : 60;
  const ticks = Array.from({ length: Math.floor(horizonSec / step) + 1 }, (_, i) => i * step);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Time and distance diagram of ${rows.length} signals. The vehicle makes ${projection.stopsMade} stops and waits ${projection.waitSec} seconds.`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={x(t)}
            x2={x(t)}
            y1={TOP}
            y2={H - BOTTOM}
            stroke="currentColor"
            strokeOpacity={0.1}
          />
          <text
            x={x(t)}
            y={H - 8}
            textAnchor="middle"
            fontSize={9}
            fill="currentColor"
            fillOpacity={0.6}
          >
            {t === 0 ? "now" : `${t / 60} min`}
          </text>
        </g>
      ))}
      {rows.map((row) => (
        <g key={`${row.stop.junctionId}-${row.stop.alongM}`}>
          <line
            x1={LEFT}
            x2={W - RIGHT}
            y1={y(row.stop.alongM)}
            y2={y(row.stop.alongM)}
            stroke="var(--signal-high)"
            strokeOpacity={0.45}
            strokeWidth={2}
          />
          {row.windows.map((w) => (
            <rect
              key={w.startSec}
              x={x(Math.max(0, w.startSec))}
              y={y(row.stop.alongM) - 3}
              width={Math.max(0, x(w.endSec) - x(Math.max(0, w.startSec)))}
              height={6}
              rx={2}
              fill="var(--signal-low)"
            />
          ))}
          <text
            x={LEFT - 6}
            y={y(row.stop.alongM) + 3}
            textAnchor="end"
            fontSize={9.5}
            fill="currentColor"
            fillOpacity={0.75}
          >
            <title>{row.stop.name}</title>
            {short(row.stop.name)}
          </text>
        </g>
      ))}
      <polyline
        points={track.map((p) => `${x(p.t)},${y(p.x)}`).join(" ")}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      {rows
        .filter((r) => r.waitSec > 0)
        .map((r) => (
          <circle
            key={`wait-${r.stop.junctionId}`}
            cx={x(r.arriveSec)}
            cy={y(r.stop.alongM)}
            r={3.5}
            fill="var(--signal-moderate)"
            stroke="#0b1030"
            strokeWidth={1}
          />
        ))}
    </svg>
  );
}

/**
 * Whether a trip would meet green lights if driven at 40 km/h, drawn from the signals' present
 * plans, and a button that makes them turn green for it.
 */
export function GreenWavePanel({
  route,
  run,
  launcher,
}: {
  route: RouteAssessment | undefined;
  run: PriorityRunStatus | null;
  launcher: RunLauncher;
}) {
  const now = useSecondClock();
  const stops = useMemo(() => (route ? stopsForRoute(route.route.coordinates) : []), [route]);
  const speed = RUN_SETTINGS.wave.speedMps;
  // Plans change slowly; project again every 2 seconds, not on every redraw.
  const slice = Math.floor(now / 2000);
  const projection = useMemo(() => {
    if (stops.length === 0) return null;
    const plans = getSignalPlans(stops.map((s) => s.roadId));
    return projectDrive(stops, plans, slice * 2000, speed);
    // slice stands for the clock here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, slice, speed]);

  if (!route) return null;
  const waveRunning = run?.kind === "wave";

  return (
    <section className="panel space-y-3 p-4" aria-label="Green wave">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Waves className="h-5 w-5 text-primary" aria-hidden />
          Green wave
        </h2>
        <p className="text-xs text-muted-foreground">
          Drive this route at 40 km/h with the signals as they are now, and see where you would meet
          red. A green wave times them so you do not.
        </p>
      </div>

      {waveRunning && run ? (
        <RunStatus status={run} onCancel={launcher.cancel} />
      ) : projection && projection.rows.length > 0 ? (
        <>
          <div className="glass-inset p-2 text-muted-foreground">
            <TimeSpaceDiagram projection={projection} />
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px]">
              <span className="flex items-center gap-1">
                <i className="inline-block h-1.5 w-3 rounded bg-signal-low" aria-hidden /> green
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block h-0.5 w-3 bg-signal-high/60" aria-hidden /> red
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block h-0.5 w-3 bg-primary" aria-hidden /> your car
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block h-2 w-2 rounded-full bg-signal-moderate" aria-hidden />{" "}
                stopped at red
              </span>
            </p>
          </div>
          <p className="text-sm" aria-live="polite">
            {projection.stopsMade === 0 ? (
              <>
                You would pass all <span className="numeric">{projection.rows.length}</span> signals
                over the next {Math.round(projection.horizonSec / 60)} minutes without stopping, as
                they stand now.
              </>
            ) : (
              <>
                You would stop at{" "}
                <span className="numeric text-signal-moderate">{projection.stopsMade}</span> of the
                first <span className="numeric">{projection.rows.length}</span> signals and lose{" "}
                <span className="numeric text-signal-moderate">{projection.waitSec} s</span>{" "}
                waiting.
              </>
            )}
          </p>
          <PaceSelect launcher={launcher} />
          <button
            type="button"
            disabled={run !== null}
            onClick={() => launcher.startWave(route)}
            className="glass-button inline-flex min-h-10 w-full items-center justify-center gap-2 px-4 py-2 text-xs font-semibold disabled:opacity-45"
          >
            <Waves className="h-3.5 w-3.5" aria-hidden />
            {run
              ? "Another run is going"
              : `Run a green wave over ${formatKm(route.route.distanceM)}`}
          </button>
          <p className="text-[11px] leading-snug text-muted-foreground">
            The diagram assumes each signal keeps its present share of the cycle for the next few
            minutes; the adaptive controller changes that as queues change, so the nearest signals
            are the firmest. Running the wave turns each green just ahead of the car and the side
            roads wait for it.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No modelled signals lie along this route.</p>
      )}
      {launcher.error && waveRunning ? (
        <p role="status" className="text-[11px] text-signal-moderate">
          {launcher.error}
        </p>
      ) : null}
    </section>
  );
}
