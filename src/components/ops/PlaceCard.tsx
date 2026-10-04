import { ArrowRightFromLine, ArrowRightToLine, MapPinCheck, MapPinned, Radio } from "lucide-react";
import type { JunctionFlow } from "@/lib/traffic-flow";
import type { SpeedSample } from "@/lib/traffic-history";
import { formatIstTime, istDate, istHourOf, type JunctionForecast } from "@/lib/forecast";
import type { JunctionSummary, RoadState } from "@/lib/traffic-types";
import { isClearing } from "@/lib/signal-aspect";
import { useSecondClock } from "@/components/space/useFontsReady";

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
const BAR: Record<string, string> = {
  LOW: "bg-signal-low",
  MODERATE: "bg-signal-moderate",
  HIGH: "bg-signal-high",
};

type DayPoint = { hour: number; saturation: number; level: string };

const hourLabel = (hour: number) => formatIstTime(istDate(hour));

/** "North has the green for 12 more seconds", from the live controller state. */
function SignalNow({ roads }: { roads: RoadState[] }) {
  const now = useSecondClock();
  const green = roads.find((r) => r.is_currently_green);
  if (!green) return null;
  const started = green.phase_started_at ? new Date(green.phase_started_at).getTime() : now;
  const clearing = isClearing(
    roads.map((r) => ({
      id: r.road_id,
      isGreen: r.is_currently_green,
      startedAtMs: r.phase_started_at ? Date.parse(r.phase_started_at) : 0,
    })),
    now,
  );
  const left = Math.max(0, Math.round(green.green_duration_sec - (now - started) / 1000));
  const dir = green.direction.charAt(0) + green.direction.slice(1).toLowerCase();
  return (
    <p className="mt-3 flex items-center gap-2 text-sm">
      <Radio
        className={`h-4 w-4 ${clearing ? "text-signal-moderate" : "text-signal-low signal-live"}`}
        aria-hidden
      />
      <span>
        {clearing ? (
          <>
            Changing over, <span className="font-medium">{dir}</span> is next
          </>
        ) : (
          <>
            <span className="font-medium">{dir}</span> has the green, {left} s left
          </>
        )}
      </span>
    </p>
  );
}

/** What the real road is doing here, and how far to trust where this junction is placed. */
/** Real road speed around the junction over the readings seen so far; the dashed line is free flow. */
function SpeedLine({ speeds }: { speeds: SpeedSample[] }) {
  const W = 220;
  const H = 30;
  const first = speeds[0]!.t;
  const span = Math.max(speeds[speeds.length - 1]!.t - first, 1);
  const points = speeds
    .map(
      (s) =>
        `${(((s.t - first) / span) * (W - 4) + 2).toFixed(1)},${(H - 3 - Math.min(1, s.ratio) * (H - 6)).toFixed(1)}`,
    )
    .join(" ");
  const minutes = Math.max(1, Math.round(span / 60_000));
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-7 min-w-0 flex-1"
        role="img"
        aria-label={`Real road speed here over the last ${minutes} minutes`}
      >
        <line
          x1="0"
          x2={W}
          y1="3"
          y2="3"
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeDasharray="3 3"
        />
        <polyline
          points={points}
          fill="none"
          stroke="var(--signal-low)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span className="shrink-0 text-[11px]">last {minutes} min</span>
    </div>
  );
}

function RealTraffic({
  flow,
  verified,
  isForecast,
  speeds,
}: {
  flow: JunctionFlow | undefined;
  verified: boolean | undefined;
  isForecast: boolean;
  speeds: SpeedSample[];
}) {
  const percent = flow?.ratio == null ? null : Math.round(flow.ratio * 100);
  return (
    <div className="glass-inset mt-3 space-y-1 p-2.5 text-xs">
      {percent !== null ? (
        <p className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 shrink-0 text-signal-low signal-live" aria-hidden />
          <span>
            Real roads here move at <span className="numeric font-medium">{percent}%</span> of
            free-flow speed
            <span className="text-muted-foreground">
              {" "}
              (TomTom, {flow?.samples} {flow?.samples === 1 ? "segment" : "segments"})
              {isForecast ? ", now" : ""}
            </span>
          </span>
        </p>
      ) : flow ? (
        <p className="text-muted-foreground">TomTom has no reading on the roads near here.</p>
      ) : null}
      {speeds.length >= 2 ? <SpeedLine speeds={speeds} /> : null}
      {verified !== undefined ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          {verified ? (
            <MapPinCheck className="h-3.5 w-3.5 shrink-0 text-signal-low" aria-hidden />
          ) : (
            <MapPinned className="h-3.5 w-3.5 shrink-0 text-signal-moderate" aria-hidden />
          )}
          {verified
            ? "Placed on a real signal mapped in OpenStreetMap."
            : "Position is approximate: no mapped signal within 450 m, so readings here are for the nearest roads."}
        </p>
      ) : null}
    </div>
  );
}

export function PlaceCard({
  junction,
  forecast,
  profile,
  at,
  isForecast,
  fromLiveModel,
  roads,
  weekend,
  onDirectionsFrom,
  onDirectionsTo,
  realFlow,
  positionVerified,
  speeds = [],
}: {
  junction: JunctionSummary;
  forecast: JunctionForecast;
  profile: DayPoint[];
  at: Date;
  isForecast: boolean;
  /** True when the figures come from the running model rather than the steady-state forecast. */
  fromLiveModel: boolean;
  roads: RoadState[];
  /** Whether the moment being looked at falls on a Saturday or Sunday in Chennai. */
  weekend: boolean;
  onDirectionsFrom: () => void;
  onDirectionsTo: () => void;
  /** What TomTom reports for the roads around this junction, when live traffic is on. */
  realFlow?: JunctionFlow | undefined;
  /** Whether this junction's position was matched to a mapped signal in OpenStreetMap. */
  positionVerified?: boolean | undefined;
  /** Real road speeds seen around this junction so far, oldest first. */
  speeds?: SpeedSample[];
}) {
  const hour = Math.floor(istHourOf(at));
  // Signed: negative means the adaptive plan is predicted to wait longer than the timer here.
  const saved =
    forecast.delayFixed > 0
      ? Math.round(((forecast.delayFixed - forecast.delayAdaptive) / forecast.delayFixed) * 100)
      : 0;
  const peak = profile.reduce(
    (best, p) => (p.saturation > best.saturation ? p : best),
    profile[0]!,
  );

  return (
    <section aria-label="Selected junction" className="panel hud-frame p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="meta-label">{junction.zone} zone</p>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug">{junction.name}</h2>
        </div>
        <span
          className={`transition-data shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${LEVEL_STYLE[junction.congestion_level]}`}
        >
          {LEVEL_LABEL[junction.congestion_level]}
        </span>
      </div>

      {isForecast ? (
        <p className="mt-2 text-xs text-primary">
          Forecast for {formatIstTime(at)}, from the traffic model. The panels below the map card
          still show the present.
        </p>
      ) : (
        <SignalNow roads={roads} />
      )}

      {realFlow || positionVerified !== undefined ? (
        <RealTraffic
          flow={realFlow}
          verified={positionVerified}
          isForecast={isForecast}
          speeds={speeds}
        />
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div className="glass-inset p-2.5">
          <dt className="meta-label">Wait per vehicle, adaptive{fromLiveModel ? ", now" : ""}</dt>
          <dd className="numeric text-xl text-primary">{Math.round(forecast.delayAdaptive)} s</dd>
        </div>
        <div className="glass-inset p-2.5">
          <dt className="meta-label">
            Wait per vehicle, fixed timer{fromLiveModel ? ", now" : ""}
          </dt>
          <dd className="numeric text-xl">{Math.round(forecast.delayFixed)} s</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        {forecast.overCapacity
          ? "Demand is above what this junction can serve, so queues keep growing whatever the timing."
          : saved >= 3
            ? `Adaptive timing cuts the wait by about ${saved}% here.`
            : saved <= -3
              ? `At this hour the fixed timer is predicted to wait about ${-saved}% less than adaptive here.`
              : "At this hour the fixed timer is about as good as adaptive."}
      </p>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <p className="meta-label">{weekend ? "A typical weekend day" : "A typical weekday"}</p>
          <p className="text-xs text-muted-foreground">Busiest around {hourLabel(peak.hour)}</p>
        </div>
        <div
          className="mt-2 flex h-14 items-end gap-[3px]"
          role="img"
          aria-label={`Congestion by hour of the day, busiest around ${hourLabel(peak.hour)}`}
        >
          {profile.map((p) => (
            <span
              key={p.hour}
              title={`${hourLabel(p.hour)}: ${LEVEL_LABEL[p.level]?.toLowerCase() ?? p.level}`}
              className={`flex-1 rounded-sm ${BAR[p.level]} ${p.hour === hour ? "opacity-100 ring-1 ring-white" : "opacity-55"}`}
              style={{ height: `${Math.max(8, Math.min(100, p.saturation * 75))}%` }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>12 am</span>
          <span>6 am</span>
          <span>12 pm</span>
          <span>6 pm</span>
          <span>12 am</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onDirectionsFrom}
          className="glass-button inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold"
        >
          <ArrowRightFromLine className="h-3.5 w-3.5" /> Directions from here
        </button>
        <button
          type="button"
          onClick={onDirectionsTo}
          className="glass-button inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold"
        >
          <ArrowRightToLine className="h-3.5 w-3.5" /> Directions to here
        </button>
      </div>
    </section>
  );
}
