import { AlertTriangle, Brain, CheckCircle2, Timer } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApproachModelState, ModelPerformance } from "@/lib/traffic-data";

function saturationTone(x: number) {
  if (x > 1) return "text-signal-high";
  if (x > 0.85) return "text-signal-moderate";
  return "text-signal-low";
}

export function ModelPanel({
  approaches,
  performance,
  loading,
}: {
  approaches: ApproachModelState[];
  performance: ModelPerformance | undefined;
  loading: boolean;
}) {
  const cycle = approaches[0]?.cycle_length_sec ?? 0;
  const flowTotal = approaches.reduce((sum, a) => sum + a.arrival_rate_vph, 0) || 1;
  const delayAdaptive =
    approaches.reduce((sum, a) => sum + a.predicted_delay_adaptive_sec * a.arrival_rate_vph, 0) /
    flowTotal;
  const delayFixed =
    approaches.reduce((sum, a) => sum + a.predicted_delay_fixed_sec * a.arrival_rate_vph, 0) /
    flowTotal;
  const reduction = delayFixed > 0 ? ((delayFixed - delayAdaptive) / delayFixed) * 100 : 0;

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Brain className="h-4 w-4 text-primary" />
            Traffic model & prediction
          </h2>
          <p className="text-xs text-muted-foreground">
            Arrival rates are estimated from the live readings, the cycle is set by Webster&apos;s
            optimal-cycle formula, and waiting time is predicted from queue behaviour — not from the
            timer difference.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <Timer className="h-3.5 w-3.5" />
          Cycle <span className="numeric">{cycle}</span>s
        </span>
      </div>

      {loading ? (
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : approaches.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          The model has not run for this junction yet.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface/40 p-3">
              <p className="meta-label">Predicted wait / vehicle</p>
              <p className="numeric mt-1 text-xl text-signal-low transition-data">
                {delayAdaptive.toFixed(1)}
                <span className="ml-0.5 text-xs text-muted-foreground">s</span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                fixed timer: <span className="numeric">{delayFixed.toFixed(1)}s</span>
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface/40 p-3">
              <p className="meta-label">Predicted congestion drop</p>
              <p className="numeric mt-1 text-xl text-primary transition-data">
                {reduction > 0 ? reduction.toFixed(0) : "0"}
                <span className="ml-0.5 text-xs text-muted-foreground">%</span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">vs fixed 30s / 120s plan</p>
            </div>
            <div className="rounded-lg border border-border bg-surface/40 p-3">
              <p className="meta-label">Queue forecast accuracy</p>
              <p className="numeric mt-1 text-xl transition-data">
                {performance ? Math.round(performance.hitRate * 100) : 0}
                <span className="ml-0.5 text-xs text-muted-foreground">%</span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                ±{performance?.meanAbsError ?? 0} vehicles over{" "}
                <span className="numeric">{performance?.samples ?? 0}</span> checks
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Approach</th>
                  <th className="py-2 pr-3 font-medium">Arrivals</th>
                  <th className="py-2 pr-3 font-medium">Discharge</th>
                  <th className="py-2 pr-3 font-medium">Load</th>
                  <th className="py-2 pr-3 font-medium">Green</th>
                  <th className="py-2 pr-3 font-medium">Queue → next</th>
                  <th className="py-2 font-medium">Wait</th>
                </tr>
              </thead>
              <tbody>
                {approaches.map((a) => (
                  <tr key={a.road_id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 font-medium">{a.direction}</td>
                    <td className="numeric py-2 pr-3">{a.arrival_rate_vph}/h</td>
                    <td className="numeric py-2 pr-3 text-muted-foreground">
                      {a.saturation_flow_vph}/h
                    </td>
                    <td className={`numeric py-2 pr-3 ${saturationTone(a.degree_saturation)}`}>
                      {a.degree_saturation.toFixed(2)}
                    </td>
                    <td className="numeric py-2 pr-3 text-primary">{a.green_sec}s</td>
                    <td className="numeric py-2 pr-3">
                      {a.queue_now} → {a.predicted_queue_next}
                      {a.queue_clears ? (
                        <CheckCircle2 className="ml-1 inline h-3 w-3 text-signal-low" />
                      ) : (
                        <AlertTriangle className="ml-1 inline h-3 w-3 text-signal-moderate" />
                      )}
                    </td>
                    <td className="numeric py-2">
                      <span className="text-signal-low">
                        {a.predicted_delay_adaptive_sec.toFixed(0)}s
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        / {a.predicted_delay_fixed_sec.toFixed(0)}s
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
