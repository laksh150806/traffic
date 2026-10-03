import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingDown } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Skeleton } from "@/components/ui/skeleton";
import type { CyclePoint, ModelledSaving } from "@/lib/traffic-data";

/** Signed, so a net loss reads as a loss. */
function formatSaved(totalSeconds: number) {
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.abs(totalSeconds);
  if (abs < 90) return `${sign}${Math.round(abs)} s`;
  const minutes = Math.floor(abs / 60);
  if (minutes < 90) return `${sign}${minutes} min`;
  return `${sign}${(minutes / 60).toFixed(1)} h`;
}

export function CycleChart({
  data,
  saving,
  loading,
}: {
  data: CyclePoint[];
  saving: ModelledSaving | undefined;
  loading: boolean;
}) {
  const net = saving?.seconds ?? 0;
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Predicted waiting time per cycle</h2>
          <p className="text-xs text-muted-foreground">
            Modelled average wait per vehicle under the adaptive plan, against a fixed timer set up
            for this junction's all-day average traffic. Both come from the same delay formula; the
            fixed plan is not simulated separately.
          </p>
        </div>
        <span
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-data ${
            net >= 0
              ? "border-signal-low/40 bg-signal-low/10 text-signal-low"
              : "border-signal-moderate/40 bg-signal-moderate/10 text-signal-moderate"
          }`}
          title="A model prediction summed over every junction, not a measurement."
        >
          <TrendingDown className="h-3.5 w-3.5" aria-hidden />
          <span>
            <span className="numeric">{formatSaved(net)}</span> of vehicle waiting{" "}
            {net >= 0 ? "avoided" : "added"}, modelled, last{" "}
            <span className="numeric">{saving?.windowMin ?? 0}</span> min, whole network
          </span>
        </span>
      </div>

      <div className="mt-4 h-[240px]">
        {loading ? (
          <Skeleton className="h-full w-full rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="cycle_number"
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tickFormatter={(v: number) => `#${v}`}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={38}
                unit="s"
              />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.22 0.06 280 / 0.6)",
                  backdropFilter: "blur(16px) saturate(1.6)",
                  border: "1px solid oklch(1 0 0 / 0.16)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "var(--foreground)",
                }}
                labelFormatter={(v) => `Update #${v}`}
                formatter={(value: number, name: string) => [`${value}s`, name]}
              />
              <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
              <Line
                type="monotone"
                dataKey="delay_fixed"
                name="Predicted wait, fixed timer"
                stroke="var(--baseline)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={!reduceMotion}
                animationDuration={350}
              />
              <Line
                type="monotone"
                dataKey="delay_adaptive"
                name="Predicted wait, adaptive"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={!reduceMotion}
                animationDuration={350}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
