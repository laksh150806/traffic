import { Ambulance, Check, Waves, X } from "lucide-react";
import { RUN_SETTINGS } from "@/lib/priority-run";
import { formatKm, formatMinutes } from "@/lib/routing";
import type { PriorityRunStatus } from "@/lib/sim-engine";

const PHASE_DOT = {
  ahead: "bg-muted",
  clearing: "bg-signal-low shadow-[0_0_8px_1px_var(--signal-low)] signal-live",
  passed: "bg-primary/60",
} as const;

const PHASE_WORD = { ahead: "ahead", clearing: "green for it", passed: "cleared" } as const;

/** Progress of a priority run: where it is, what it has cleared, and what that cost the rest. */
export function RunStatus({
  status,
  onCancel,
}: {
  status: PriorityRunStatus;
  onCancel: () => void;
}) {
  const Icon = status.kind === "ambulance" ? Ambulance : Waves;
  const settings = RUN_SETTINGS[status.kind];
  const percent =
    status.totalM > 0 ? Math.min(100, Math.round((status.progressM / status.totalM) * 100)) : 100;
  const next = status.stops.find((s) => s.phase !== "passed");
  const total = status.stops.length;

  return (
    <div
      className="glass-inset space-y-3 p-3"
      role="group"
      aria-label={`${status.label}, ${percent} percent of the route`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              status.kind === "ambulance"
                ? "bg-signal-high/20 text-signal-high"
                : "bg-primary/20 text-primary"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-tight">{status.label}</p>
            <p className="text-[11px] text-muted-foreground" aria-live="polite">
              {status.finished
                ? "Reached the end of its route"
                : next
                  ? `${next.phase === "clearing" ? "Green at" : "Next signal"} ${next.name}`
                  : "On the last stretch"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="glass-chip transition-data flex min-h-8 shrink-0 items-center gap-1 px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {status.finished ? (
            <>
              <Check className="h-3 w-3" aria-hidden /> Done
            </>
          ) : (
            <>
              <X className="h-3 w-3" aria-hidden /> Cancel
            </>
          )}
        </button>
      </div>

      <div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              status.kind === "ambulance" ? "bg-signal-high" : "bg-primary"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span className="numeric">
            {formatKm(status.progressM)} of {formatKm(status.totalM)}
          </span>
          <span className="numeric">
            {status.finished ? "arrived" : `${formatMinutes(status.etaSec)} to go`}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="numeric text-lg">
            {status.passed}
            <span className="text-xs text-muted-foreground"> / {total}</span>
          </p>
          <p className="meta-label">Signals cleared</p>
        </div>
        <div>
          <p className="numeric text-lg text-signal-low">
            {status.savedSec}
            <span className="ml-0.5 text-xs text-muted-foreground">s</span>
          </p>
          <p className="meta-label">Wait avoided</p>
        </div>
        <div>
          <p className="numeric text-lg text-signal-moderate">{status.heldVehicles}</p>
          <p className="meta-label">Held on side roads</p>
        </div>
      </div>

      {total > 0 ? (
        <ol className="scroll-glass max-h-28 space-y-1 overflow-y-auto pr-1">
          {status.stops.map((stop) => (
            <li
              key={`${stop.junctionId}-${stop.alongM}`}
              className="flex items-center gap-2 text-xs"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${PHASE_DOT[stop.phase]}`}
                aria-hidden
              />
              <span
                className={`min-w-0 flex-1 truncate ${stop.phase === "ahead" ? "text-muted-foreground" : "text-foreground"}`}
              >
                {stop.name}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {PHASE_WORD[stop.phase]}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">
          No modelled signals on this route, so nothing needed clearing.
        </p>
      )}

      <p className="text-[11px] leading-snug text-muted-foreground">
        Moves at {Math.round(settings.speedMps * 3.6)} km/h
        {status.speedFactor > 1 ? `, shown ${status.speedFactor} times faster than real time` : ""}.
        Each signal starts changing {settings.leadSec} s before it arrives, never cuts a green
        shorter than {settings.minGreenSec} s, and keeps the 4 s amber and all-red. Wait avoided is
        what the model gives an ordinary vehicle at those approaches.
      </p>
    </div>
  );
}
