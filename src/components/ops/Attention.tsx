import { AlertTriangle } from "lucide-react";
import type { JunctionForecast } from "@/lib/forecast";
import type { JunctionSummary } from "@/lib/traffic-types";

const DOT: Record<string, string> = {
  LOW: "bg-signal-low",
  MODERATE: "bg-signal-moderate",
  HIGH: "bg-signal-high",
};
const RANK = { LOW: 0, MODERATE: 1, HIGH: 2 } as const;

function reason(summary: JunctionSummary, forecast: JunctionForecast | undefined) {
  if (forecast?.overCapacity) return "Over capacity, queues will keep growing";
  if (forecast && forecast.maxQueue >= 40 && summary.congestion_level !== "LOW") {
    return "One arm is badly backed up";
  }
  if (summary.congestion_level === "HIGH") return "Jammed, queues are long";
  if (summary.congestion_level === "MODERATE") return "Busy, close to capacity";
  return "Flowing";
}

/** The junctions an operator should look at first, worst on top. */
export function Attention({
  junctions,
  forecast,
  selectedId,
  onSelect,
  limit = 6,
}: {
  junctions: JunctionSummary[];
  forecast: ReadonlyMap<number, JunctionForecast>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  limit?: number;
}) {
  // Only junctions that are not flowing freely need attention; show fewer rows when few qualify.
  const ranked = [...junctions]
    .filter((j) => j.congestion_level !== "LOW")
    .sort(
      (a, b) =>
        RANK[b.congestion_level] - RANK[a.congestion_level] ||
        b.avg_vehicle_count - a.avg_vehicle_count,
    )
    .slice(0, limit);
  const jammed = junctions.filter((j) => j.congestion_level === "HIGH").length;

  return (
    <section aria-label="Needs attention" className="glass-inset p-3">
      <div className="flex items-center justify-between">
        <p className="meta-label flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-signal-moderate" aria-hidden /> Needs attention
        </p>
        <span className="text-xs text-muted-foreground">
          {jammed} of {junctions.length} jammed
        </span>
      </div>
      {ranked.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Every junction is flowing freely at this time.
        </p>
      ) : null}
      <ol className="mt-2 space-y-1">
        {ranked.map((junction, index) => (
          <li key={junction.junction_id}>
            <button
              type="button"
              onClick={() => onSelect(junction.junction_id)}
              aria-current={junction.junction_id === selectedId}
              className={`transition-data flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${
                junction.junction_id === selectedId ? "bg-white/12" : "hover:bg-white/6"
              }`}
            >
              <span className="numeric w-4 text-xs text-muted-foreground">{index + 1}</span>
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[junction.congestion_level]}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{junction.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {reason(junction, forecast.get(junction.junction_id))}
                </span>
              </span>
              <span className="numeric text-xs text-muted-foreground">
                {junction.avg_vehicle_count}
                <span className="sr-only"> vehicles per approach</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
