import { useEffect, useRef, useState } from "react";
import {
  Ambulance,
  CloudRain,
  Hand,
  Radio,
  Sun,
  TriangleAlert,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { rainAt, rainLabel, type WeatherSnapshot } from "@/lib/weather";
import type { LiveTraffic } from "@/components/ops/useLiveTraffic";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import { AnimatedNumber } from "@/components/space/AnimatedNumber";
import { useSecondClock } from "@/components/space/useFontsReady";
import { Skeleton } from "@/components/ui/skeleton";
import type { EngineActivity } from "@/components/ops/usePriorityRuns";
import type { ModelledSaving } from "@/lib/traffic-types";

export type BoardStat = {
  label: string;
  value: number;
  suffix: string;
  icon: LucideIcon;
  note: string | null;
};

type Sample = { adaptive: number; fixed: number };
const MAX_SAMPLES = 40;

/** Two lines on a shared scale: the average wait under the adaptive plan and under a fixed timer. */
function Sparkline({ samples }: { samples: Sample[] }) {
  const W = 132;
  const H = 40;
  const values = samples.flatMap((s) => [s.adaptive, s.fixed]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, 1);
  const step = samples.length > 1 ? (W - 4) / (samples.length - 1) : 0;
  const line = (pick: (s: Sample) => number) =>
    samples
      .map((s, i) => `${2 + i * step},${H - 4 - ((pick(s) - low) / span) * (H - 8)}`)
      .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full" aria-hidden>
      <polyline
        points={line((s) => s.fixed)}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeOpacity={0.7}
        strokeWidth={1.5}
        strokeDasharray="3 3"
        strokeLinejoin="round"
      />
      <polyline
        points={line((s) => s.adaptive)}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const ago = (seconds: number) =>
  seconds < 5
    ? "just now"
    : seconds < 90
      ? `${seconds} s ago`
      : `${Math.round(seconds / 60)} min ago`;

const TONE = {
  info: "bg-primary/70",
  good: "bg-signal-low",
  warn: "bg-signal-moderate",
} as const;

/**
 * The first thing in the left column: the headline numbers, how much waiting the adaptive plan
 * is avoiding, how the network wait has moved, and what operators and vehicles have been doing.
 */
export function CityBoard({
  stats,
  loading,
  saved,
  adaptiveDelay,
  fixedDelay,
  activity,
  weather = null,
  liveTraffic,
  trafficDriving = true,
}: {
  stats: BoardStat[];
  loading: boolean;
  saved: ModelledSaving | undefined;
  adaptiveDelay: number | undefined;
  fixedDelay: number | undefined;
  /** Present only when the app runs its own simulation. */
  activity?: EngineActivity;
  weather?: WeatherSnapshot | null;
  liveTraffic?: LiveTraffic;
  trafficDriving?: boolean;
}) {
  const now = useSecondClock();
  const [samples, setSamples] = useState<Sample[]>([]);
  const lastSample = useRef("");

  useEffect(() => {
    if (adaptiveDelay === undefined || fixedDelay === undefined) return;
    const key = `${adaptiveDelay}|${fixedDelay}`;
    if (key === lastSample.current) return;
    lastSample.current = key;
    setSamples((prev) =>
      [...prev, { adaptive: adaptiveDelay, fixed: fixedDelay }].slice(-MAX_SAMPLES),
    );
  }, [adaptiveDelay, fixedDelay]);

  const hours = (saved?.seconds ?? 0) / 3600;
  // Real road speed across the network, from the junctions TomTom had a reading for.
  const speeds =
    liveTraffic && (liveTraffic.status === "live" || liveTraffic.status === "stale")
      ? liveTraffic.snapshot.junctions.filter(
          (j): j is typeof j & { ratio: number } => j.ratio !== null,
        )
      : [];
  const meanSpeed = speeds.length
    ? speeds.reduce((sum, j) => sum + j.ratio, 0) / speeds.length
    : null;
  const slowest = speeds.length
    ? speeds.reduce((worst, j) => (j.ratio < worst.ratio ? j : worst))
    : null;
  const mm = weather ? (rainAt(now) ?? weather.current.precipMm) : null;
  const chips = activity
    ? [
        ...(liveTraffic && (liveTraffic.status === "live" || liveTraffic.status === "stale")
          ? [
              {
                key: "traffic",
                icon: Radio,
                text:
                  liveTraffic.status === "stale"
                    ? "Real traffic, last reading kept"
                    : trafficDriving
                      ? "Real traffic, TomTom"
                      : "Real traffic paused by scenario",
                cls:
                  liveTraffic.status === "live" && trafficDriving
                    ? "text-signal-low border-signal-low/40"
                    : "text-signal-moderate border-signal-moderate/40",
              },
            ]
          : []),
        ...(weather && mm !== null
          ? [
              {
                key: "weather",
                icon: mm >= 0.1 ? CloudRain : Sun,
                text: `${Number.isFinite(weather.current.tempC) ? `${Math.round(weather.current.tempC)} °C, ` : ""}${rainLabel(mm).toLowerCase()}`,
                cls:
                  mm >= 0.1
                    ? "text-primary border-primary/40"
                    : "text-muted-foreground border-border",
              },
            ]
          : []),
        ...(activity.run
          ? [
              {
                key: "run",
                icon: activity.run.kind === "ambulance" ? Ambulance : Waves,
                text: activity.run.finished
                  ? `${activity.run.label}: finished`
                  : `${activity.run.label}: ${activity.run.passed} of ${activity.run.stops.length} signals`,
                cls:
                  activity.run.kind === "ambulance"
                    ? "text-signal-high border-signal-high/40"
                    : "text-primary border-primary/40",
              },
            ]
          : []),
        ...(activity.overrides.length > 0
          ? [
              {
                key: "hold",
                icon: Hand,
                text: `${activity.overrides.length} operator ${activity.overrides.length === 1 ? "hold" : "holds"}`,
                cls: "text-signal-moderate border-signal-moderate/40",
              },
            ]
          : []),
        ...(activity.incidents.length > 0
          ? [
              {
                key: "inc",
                icon: TriangleAlert,
                text: `${activity.incidents.length} reported ${activity.incidents.length === 1 ? "problem" : "problems"}`,
                cls: "text-signal-high border-signal-high/40",
              },
            ]
          : []),
      ]
    : [];

  return (
    <section aria-label="City board" className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-inset px-3 py-2.5">
            <p className="meta-label flex items-center gap-1.5">
              <stat.icon className="h-3 w-3" aria-hidden />
              {stat.label}
            </p>
            {loading ? (
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
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{stat.note}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="glass-inset px-3 py-2.5">
          <p className="meta-label">Waiting avoided</p>
          {loading || !saved ? (
            <Skeleton className="mt-1 h-7 w-20" />
          ) : (
            <p className="mt-0.5">
              <AnimatedNumber
                value={hours}
                decimals={1}
                className={`numeric text-2xl ${hours >= 0 ? "text-signal-low" : "text-signal-moderate"}`}
              />
              <span className="ml-1 text-xs text-muted-foreground">vehicle-hours</span>
            </p>
          )}
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            Modelled, last {saved?.windowMin ?? 0} min, whole network
          </p>
        </div>
        <div className="glass-inset px-3 py-2.5">
          <p className="meta-label">Average wait</p>
          {samples.length > 1 ? (
            <Sparkline samples={samples} />
          ) : (
            <Skeleton className="mt-1 h-10 w-full" />
          )}
          <p className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <i className="inline-block h-0.5 w-3 bg-primary" aria-hidden />
              <span className="numeric">
                {adaptiveDelay === undefined ? "–" : `${adaptiveDelay} s`}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <i
                className="inline-block h-0.5 w-3 border-t border-dashed border-muted-foreground"
                aria-hidden
              />
              fixed{" "}
              <span className="numeric">{fixedDelay === undefined ? "–" : `${fixedDelay} s`}</span>
            </span>
          </p>
        </div>
      </div>

      {meanSpeed !== null && slowest ? (
        <div className="glass-inset px-3 py-2.5">
          <p className="meta-label">Real road speed, TomTom</p>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
            <AnimatedNumber
              value={Math.round(meanSpeed * 100)}
              suffix="%"
              className="numeric text-2xl text-signal-low"
            />
            <span className="text-xs text-muted-foreground">
              of free-flow speed, {speeds.length} junctions
            </span>
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            Slowest: {SEED_JUNCTIONS.find((j) => j.id === slowest.id)?.name ?? "a junction"} at{" "}
            {Math.round(slowest.ratio * 100)}%
          </p>
        </div>
      ) : null}

      {activity ? (
        <div className="glass-inset px-3 py-2.5">
          {chips.length > 0 ? (
            <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Active now">
              {chips.map(({ key, icon: Icon, text, cls }) => (
                <li
                  key={key}
                  className={`glass-chip flex items-center gap-1.5 border px-2.5 py-1 text-[11px] ${cls}`}
                >
                  <Icon className="h-3 w-3" aria-hidden />
                  {text}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="meta-label">Activity</p>
          {activity.events.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing yet. Hold a green, report a problem or send an ambulance and it shows here.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1.5" aria-live="polite">
              {activity.events.slice(0, 5).map((event) => (
                <li key={`${event.atMs}-${event.text}`} className="flex items-start gap-2 text-xs">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE[event.tone]}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 leading-snug">{event.text}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {ago(Math.max(0, Math.round((now - event.atMs) / 1000)))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {activity ? (
        <p className="px-1 text-[10px] leading-snug text-muted-foreground">
          {liveTraffic && (liveTraffic.status === "live" || liveTraffic.status === "stale")
            ? "Traffic data © TomTom. "
            : ""}
          {weather ? "Weather by Open-Meteo. " : ""}
          Signal positions © OpenStreetMap contributors.
        </p>
      ) : null}
    </section>
  );
}
