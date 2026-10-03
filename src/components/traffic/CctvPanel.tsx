import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Video } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Skeleton } from "@/components/ui/skeleton";
import type { CctvPoint } from "@/lib/traffic-data";

export function CctvPanel({ data, loading }: { data: CctvPoint[]; loading: boolean }) {
  const latest = data.length > 0 ? data[data.length - 1] : null;
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Video className="h-4 w-4 text-primary" />
            Simulated CCTV detection
          </h2>
          <p className="text-xs text-muted-foreground">
            Vehicles a camera model would detect per frame, generated from the simulated queue plus
            noise. There is no real video.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full glass-inset px-3 py-1 text-[11px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-signal-moderate signal-live" />
          SIMULATED
          {latest ? (
            <span className="numeric ml-1 text-foreground">
              {latest.camera_name}, {Math.round(latest.confidence_avg * 100)}% confidence
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
                dataKey="analyzed_at"
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                minTickGap={24}
                tickFormatter={(v: string) =>
                  new Date(v).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })
                }
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
                  background: "oklch(0.22 0.06 280 / 0.6)",
                  backdropFilter: "blur(16px) saturate(1.6)",
                  border: "1px solid oklch(1 0 0 / 0.16)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "var(--foreground)",
                }}
                labelFormatter={(v) => new Date(String(v)).toLocaleTimeString()}
                formatter={(value: number, _name, entry) => {
                  const point = entry?.payload as CctvPoint | undefined;
                  return [
                    `${value} vehicles`,
                    `${point?.camera_name ?? "Camera"}, frame ${point?.frame_number ?? "?"}`,
                  ];
                }}
              />
              <Line
                type="monotone"
                dataKey="vehicles_detected"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={{ r: 2, fill: "var(--primary)" }}
                activeDot={{ r: 4 }}
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
