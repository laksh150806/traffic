import { useState, type CSSProperties } from "react";
import { Ambulance, Loader2 } from "lucide-react";
import { HOSPITALS } from "@/lib/priority-run";
import type { PriorityRunStatus } from "@/lib/sim-engine";
import type { JunctionSummary } from "@/lib/traffic-types";
import { nearestHospital, type RunLauncher } from "@/components/ops/usePriorityRuns";
import { RunStatus } from "@/components/ops/RunStatus";
import { PaceSelect } from "@/components/ops/PaceSelect";

const NEAREST = "nearest";

/**
 * Send an ambulance from the selected junction to a hospital and watch the signals along the road
 * turn green for it one after another, with the cost to the cross traffic counted.
 */
export function PriorityRunPanel({
  junction,
  run,
  launcher,
}: {
  junction: JunctionSummary | undefined;
  run: PriorityRunStatus | null;
  launcher: RunLauncher;
}) {
  const [choice, setChoice] = useState(NEAREST);
  const hospital =
    choice === NEAREST
      ? junction
        ? nearestHospital(junction.latitude, junction.longitude)
        : undefined
      : HOSPITALS.find((h) => h.id === choice);

  return (
    <section className="panel space-y-3 p-4" aria-label="Emergency vehicle">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Ambulance className="h-5 w-5 text-signal-high" aria-hidden />
          Emergency vehicle
        </h2>
        <p className="text-xs text-muted-foreground">
          Send an ambulance across the network. Each signal on its road turns green just before it
          arrives, then goes back to the controller.
        </p>
      </div>

      {run && run.kind === "ambulance" ? (
        <RunStatus status={run} onCancel={launcher.cancel} />
      ) : (
        <>
          <label className="block">
            <span className="meta-label">Going to</span>
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className="glass-chip mt-1 min-h-10 w-full bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value={NEAREST} className="bg-card">
                Nearest hospital{hospital && choice === NEAREST ? `: ${hospital.name}` : ""}
              </option>
              {HOSPITALS.map((h) => (
                <option key={h.id} value={h.id} className="bg-card">
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <PaceSelect launcher={launcher} />
          <button
            type="button"
            disabled={!junction || !hospital || launcher.planning || run !== null}
            onClick={() => {
              if (!junction || !hospital) return;
              launcher.sendAmbulance(
                { lat: junction.latitude, lng: junction.longitude, name: junction.name },
                hospital,
              );
            }}
            className="glass-button inline-flex min-h-10 w-full items-center justify-center gap-2 px-4 py-2 text-xs font-semibold disabled:opacity-45"
            style={{ "--tint": "var(--signal-high)" } as CSSProperties}
          >
            {launcher.planning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Ambulance className="h-3.5 w-3.5" aria-hidden />
            )}
            {launcher.planning
              ? "Finding the road"
              : junction
                ? `Send from ${junction.name}`
                : "Select a junction first"}
          </button>
          {run ? (
            <p className="text-[11px] text-muted-foreground">
              A green wave is running on the Directions tab. Cancel it there to send an ambulance.
            </p>
          ) : null}
        </>
      )}
      {launcher.error ? (
        <p role="status" className="text-[11px] text-signal-moderate">
          {launcher.error}
        </p>
      ) : null}
    </section>
  );
}
