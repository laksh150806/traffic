import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Video } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { CctvPoint } from "@/lib/traffic-data";

export function CctvPanel({ data, loading }: { data: CctvPoint[]; loading: boolean }) {
  const latest = data.length > 0 ? data[data.length - 1] : null;

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Video className="h-4 w-4 text-primary" />
            CCTV vehicle detection
          </h2>
          <p className="text-xs text-muted-foreground">
            Live feed — vehicles detected per analysed frame across this junction's cameras.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-3 py-1 text-[11px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-signal-high signal-live" />
          LIVE
          {latest ? (
            <span className="numeric ml-1 text-foreground">
              {latest.camera_name} · {Math.round(latest.confidence_avg * 100)}% conf.
            </span>
          ) : null}
        </span>
      </div>

      <div className="mt-4 h-[180px]">
        {loading ? (
          <Skeleton className="h-full w-full rounded-lg" />
        ) : data.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
            Waiting for the first analysed frames…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="frame_number"
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tickFormatter={(v: number) => `f${v}`}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "var(--foreground)",
                }}
                labelFormatter={(v) => `Frame ${v}`}
                formatter={(value: number, _name, entry) => [
                  `${value} vehicles`,
                  (entry?.payload as CctvPoint | undefined)?.camera_name ?? "Camera",
                ]}
              />
              <Line
                type="monotone"
                dataKey="vehicles_detected"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={{ r: 2, fill: "var(--primary)" }}
                activeDot={{ r: 4 }}
                animationDuration={350}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
