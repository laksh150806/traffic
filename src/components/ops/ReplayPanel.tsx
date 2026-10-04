import { useMemo } from "react";
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
import { useReducedMotion } from "motion/react";
import { Repeat } from "lucide-react";
import { formatIstTime } from "@/lib/forecast";
import { replayJunction } from "@/lib/replay";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";

const MINUTES = 30;

function Compare({
  label,
  fixed,
  adaptive,
  unit,
  lowerIsBetter = true,
}: {
  label: string;
  fixed: number;
  adaptive: number;
  unit: string;
  lowerIsBetter?: boolean;
}) {
  const better = lowerIsBetter ? adaptive < fixed : adaptive > fixed;
  const same = adaptive === fixed;
  return (
    <div className="glass-inset px-3 py-2.5">
      <p className="meta-label">{label}</p>
      <p className="numeric mt-0.5 text-lg leading-tight">
        <span className="text-muted-foreground">{fixed}</span>
        <span className="mx-1.5 text-xs text-muted-foreground" aria-hidden>
          to
        </span>
        <span className={same ? "" : better ? "text-signal-low" : "text-signal-moderate"}>
          {adaptive}
        </span>
        <span className="ml-0.5 text-xs text-muted-foreground">{unit}</span>
      </p>
      <p className="text-[11px] text-muted-foreground">fixed timer to adaptive</p>
    </div>
  );
}

/**
 * The same half hour of traffic run twice at the selected junction, once under its fixed timer and
 * once under the adaptive controller, so the claim can be seen as two queues over time.
 */
export function ReplayPanel({
  junctionId,
  startMs,
  factor,
  capacityScale,
  blocked,
}: {
  junctionId: number;
  startMs: number;
  factor: number | undefined;
  capacityScale: number | undefined;
  blocked: boolean;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const seed = SEED_JUNCTIONS.find((j) => j.id === junctionId);
  const index = SEED_JUNCTIONS.findIndex((j) => j.id === junctionId);

  const result = useMemo(
    () =>
      index < 0
        ? null
        : replayJunction(index, startMs, {
            minutes: MINUTES,
            ...(factor === undefined ? {} : { factor }),
            ...(capacityScale === undefined ? {} : { capacityScale }),
            blocked,
          }),
    [index, startMs, factor, capacityScale, blocked],
  );
  if (!result || !seed) return null;

  const s = result.summary;
  const data = result.seconds.map((sec, i) => ({
    minute: Number((sec / 60).toFixed(1)),
    fixed: result.fixed[i],
    adaptive: result.adaptive[i],
  }));
  const shorter = s.waitChangePercent >= 0;
  const quiet = Math.abs(s.waitChangePercent) < 3;

  return (
    <section className="panel p-4" aria-labelledby="replay-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="replay-title" className="flex items-center gap-2 text-lg font-semibold">
            <Repeat className="h-4 w-4 text-primary" aria-hidden />
            Replay: fixed timer against adaptive
          </h2>
          <p className="text-xs text-muted-foreground">
            The same {MINUTES} minutes of simulated traffic at {seed.name}, from{" "}
            {formatIstTime(new Date(startMs))}, run under the junction&apos;s fixed timer and under
            the adaptive controller.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
            quiet
              ? "border-border bg-muted text-muted-foreground"
              : shorter
                ? "border-signal-low/40 bg-signal-low/10 text-signal-low"
                : "border-signal-moderate/40 bg-signal-moderate/10 text-signal-moderate"
          }`}
        >
          {quiet
            ? "About the same"
            : `${Math.abs(s.waitChangePercent)}% ${shorter ? "shorter" : "longer"} wait`}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Compare label="Wait per vehicle" fixed={s.waitFixed} adaptive={s.waitAdaptive} unit="s" />
        <Compare
          label="Vehicles through"
          fixed={s.servedFixed}
          adaptive={s.servedAdaptive}
          unit=""
          lowerIsBetter={false}
        />
        <Compare
          label="Longest red"
          fixed={s.longestRedFixed}
          adaptive={s.longestRedAdaptive}
          unit="s"
        />
        <Compare
          label="Peak queue"
          fixed={Math.round(s.maxQueueFixed)}
          adaptive={Math.round(s.maxQueueAdaptive)}
          unit=""
        />
      </div>

      <div className="mt-4 h-[200px]" role="img" aria-label={replaySummary(s, MINUTES)}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="minute"
              stroke="var(--muted-foreground)"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tickFormatter={(v: number) => `${Math.round(v)}m`}
              interval={Math.floor(data.length / 6)}
            />
            <YAxis
              stroke="var(--muted-foreground)"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={34}
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
              labelFormatter={(v) => `${v} min in`}
              formatter={(value: number, name: string) => [`${value} vehicles`, name]}
            />
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
            <Line
              type="monotone"
              dataKey="fixed"
              name="Queued, fixed timer"
              stroke="var(--baseline)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={!reduceMotion}
              animationDuration={400}
            />
            <Line
              type="monotone"
              dataKey="adaptive"
              name="Queued, adaptive"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={!reduceMotion}
              animationDuration={400}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Vehicles queued across the four approaches. Both runs start from the queues this hour
        normally settles to, share the same arrivals, and lose 4 s at every change of green. The
        adaptive run is the controller on the map. This is a simulation of queues, so it can differ
        from the header's percentage, which comes from the delay formula for steady traffic. Traffic
        is simulated, so it compares the two controllers on that demand, not on a measured road.
      </p>
    </section>
  );
}

function replaySummary(s: ReturnType<typeof replayJunction>["summary"], minutes: number) {
  return `Queue over ${minutes} minutes. Average wait per vehicle ${s.waitFixed} seconds with the fixed timer and ${s.waitAdaptive} seconds with the adaptive controller.`;
}
