import { useState } from "react";
import { ArrowDownUp, Crosshair, Loader2, TriangleAlert } from "lucide-react";
import { SearchBox } from "@/components/ops/SearchBox";
import type { Endpoint } from "@/components/ops/OpsMap";
import { formatKm, formatMinutes, type RouteAssessment } from "@/lib/routing";
import { formatIstTime } from "@/lib/forecast";
import type { JunctionSummary } from "@/lib/traffic-types";

const DOT: Record<string, string> = {
  LOW: "bg-signal-low",
  MODERATE: "bg-signal-moderate",
  HIGH: "bg-signal-high",
};

type Props = {
  junctions: JunctionSummary[];
  from: Endpoint | null;
  to: Endpoint | null;
  onFrom: (point: Endpoint | null) => void;
  onTo: (point: Endpoint | null) => void;
  pick: "from" | "to" | null;
  onPickMode: (mode: "from" | "to" | null) => void;
  assessments: RouteAssessment[];
  routeIndex: number;
  onRouteIndex: (index: number) => void;
  loading: boolean;
  error: string | null;
  errorKind: "no-route" | "busy" | "unreachable" | null;
  departAt: Date;
  /** True when leaving at the present moment rather than at a forecast time. */
  departNow: boolean;
  levelOf: (junctionId: number) => string;
};

const asEndpoint = (j: JunctionSummary): Endpoint => ({
  lat: j.latitude,
  lng: j.longitude,
  label: j.name,
});

function PickButton({
  which,
  pick,
  onPickMode,
}: {
  which: "from" | "to";
  pick: Props["pick"];
  onPickMode: Props["onPickMode"];
}) {
  return (
    <button
      type="button"
      aria-label={`Pick the ${which === "from" ? "start" : "destination"} on the map`}
      aria-pressed={pick === which}
      onClick={() => onPickMode(pick === which ? null : which)}
      className={`glass-chip min-h-11 min-w-11 p-3 ${pick === which ? "text-primary" : "text-muted-foreground"}`}
    >
      <Crosshair className="h-4 w-4" />
    </button>
  );
}

export function DirectionsPanel(props: Props) {
  const { junctions, from, to, onFrom, onTo, pick, onPickMode, assessments, routeIndex } = props;
  const [open, setOpen] = useState<string | null>(null);
  const swap = () => {
    onFrom(to);
    onTo(from);
  };

  return (
    <div className="space-y-3">
      <div className="glass-inset space-y-2 p-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox
              junctions={junctions}
              label="Start"
              placeholder="Choose a start junction"
              value={from?.label ?? null}
              onPick={(j) => onFrom(asEndpoint(j))}
              onClear={() => onFrom(null)}
              icon="pin"
              tint="#4ade80"
            />
          </div>
          <PickButton which="from" pick={pick} onPickMode={onPickMode} />
        </div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox
              junctions={junctions}
              label="Destination"
              placeholder="Choose a destination"
              value={to?.label ?? null}
              onPick={(j) => onTo(asEndpoint(j))}
              onClear={() => onTo(null)}
              icon="pin"
              tint="#f472b6"
            />
          </div>
          <PickButton which="to" pick={pick} onPickMode={onPickMode} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {pick
              ? "Click the map to drop the pin."
              : `Leaving ${props.departNow ? "now" : `at ${formatIstTime(props.departAt)}`}. Change it with the time bar.`}
          </p>
          <button
            type="button"
            onClick={swap}
            disabled={!from && !to}
            className="glass-chip inline-flex shrink-0 items-center gap-1.5 px-3 py-1 text-xs disabled:opacity-40"
          >
            <ArrowDownUp className="h-3 w-3" /> Swap
          </button>
        </div>
      </div>

      {props.loading ? (
        <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Finding roads
        </p>
      ) : null}

      {props.error ? (
        <p
          className="glass-inset flex items-start gap-2 p-3 text-xs text-signal-moderate"
          role="status"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {props.errorKind === "no-route"
              ? "No drivable road route was found between these two points. Try moving a pin onto a road."
              : props.errorKind === "busy"
                ? `The free routing service is busy right now, so this is a straight-line estimate and roads are not followed. Try again in a minute. (${props.error})`
                : `The routing service could not be reached, so this is a straight-line estimate and roads are not followed. (${props.error})`}
          </span>
        </p>
      ) : null}

      {!props.loading && assessments.length === 0 && props.errorKind !== "no-route" ? (
        <p className="px-1 text-sm text-muted-foreground">
          Pick two junctions to see how long the trip takes once the delay at the modelled junctions
          is counted, and which route the signal timing favours.
        </p>
      ) : null}

      <ul className="space-y-2">
        {assessments.map((a, index) => {
          const gained = a.etaFixedSec - a.etaAdaptiveSec;
          const chosen = index === routeIndex;
          return (
            <li key={a.id}>
              <div
                className={`glass-inset transition-data p-3 ${chosen ? "ring-1 ring-primary/70" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    props.onRouteIndex(index);
                    setOpen(open === a.id ? null : a.id);
                  }}
                  aria-pressed={chosen}
                  aria-expanded={open === a.id}
                  className="block w-full text-left"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="numeric text-2xl">{formatMinutes(a.etaAdaptiveSec)}</span>
                    <span className="flex items-center gap-1.5 text-xs">
                      {index === 0 && assessments.length > 1 ? (
                        <span className="rounded-full bg-primary/20 px-2 py-0.5 font-medium text-primary">
                          Fastest
                        </span>
                      ) : null}
                      <span className="text-muted-foreground">{formatKm(a.route.distanceM)}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatMinutes(a.driveSec)} driving
                    {a.junctions.length === 0
                      ? ", no modelled junctions on the way"
                      : ` plus ${formatMinutes(a.signalAdaptiveSec)} at ${a.junctions.length} modelled ${a.junctions.length === 1 ? "junction" : "junctions"}`}
                  </p>
                  {gained >= 30 ? (
                    <p className="mt-1 text-xs text-primary">
                      Adaptive timing saves about {formatMinutes(gained)} against the fixed timers (
                      {formatMinutes(a.etaFixedSec)}).
                    </p>
                  ) : gained <= -30 ? (
                    <p className="mt-1 text-xs text-signal-moderate">
                      The fixed timers would be about {formatMinutes(-gained)} faster on this route
                      ({formatMinutes(a.etaFixedSec)}).
                    </p>
                  ) : null}
                  {a.worst && a.worst.level !== "LOW" ? (
                    <p className="mt-1 text-xs text-signal-moderate">
                      Watch: {a.worst.name} ({a.worst.level === "HIGH" ? "jammed" : "busy"})
                    </p>
                  ) : null}
                </button>

                {open === a.id && a.junctions.length > 0 ? (
                  <ol className="mt-3 space-y-1 border-t border-white/10 pt-3">
                    {a.junctions.map((stop) => (
                      <li key={stop.junctionId} className="flex items-center gap-2 text-xs">
                        <span
                          className={`h-2 w-2 rounded-full ${DOT[props.levelOf(stop.junctionId)]}`}
                        />
                        <span className="min-w-0 flex-1 truncate">{stop.name}</span>
                        <span className="numeric text-muted-foreground">
                          {(stop.alongM / 1000).toFixed(1)} km
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
