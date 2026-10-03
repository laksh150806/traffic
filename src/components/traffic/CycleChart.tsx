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
import { Skeleton } from "@/components/ui/skeleton";
import type { CyclePoint } from "@/lib/traffic-data";

function formatSaved(totalSeconds: number) {
  if (totalSeconds < 90) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

export function CycleChart({
  data,
  totalSaved,
  loading,
}: {
  data: CyclePoint[];
  totalSaved: number;
  loading: boolean;
}) {
  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Predicted waiting time per cycle</h2>
          <p className="text-xs text-muted-foreground">
            Modelled average wait per vehicle under the adaptive plan against the same demand run on
            a fixed plan (26 s green in a 120 s cycle).
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-signal-low/40 bg-signal-low/10 px-3 py-1 text-xs font-medium text-signal-low transition-data">
          <TrendingDown className="h-3.5 w-3.5" />
          <span className="numeric">{formatSaved(totalSaved)}</span> of vehicle waiting avoided
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
                labelFormatter={(v) => `Cycle #${v}`}
                formatter={(value: number, name: string) => [`${value}s`, name]}
              />
              <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
              <Line
                type="monotone"
                dataKey="delay_fixed"
                name="Predicted wait — fixed timer"
                stroke="var(--baseline)"
                strokeWidth={2}
                dot={false}
                animationDuration={350}
              />
              <Line
                type="monotone"
                dataKey="delay_adaptive"
                name="Predicted wait — model"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={false}
                animationDuration={350}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
