import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { JunctionSummary } from "@/lib/traffic-data";

const LEVELS = ["ALL", "HIGH", "MODERATE", "LOW"] as const;

const DOT: Record<string, string> = {
  LOW: "bg-signal-low",
  MODERATE: "bg-signal-moderate",
  HIGH: "bg-signal-high",
};

type Props = {
  junctions: JunctionSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
};

export function JunctionList({ junctions, selectedId, onSelect, loading }: Props) {
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState("ALL");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("ALL");

  const zones = useMemo(
    () => ["ALL", ...Array.from(new Set(junctions.map((j) => j.zone))).sort()],
    [junctions],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return junctions
      .filter((j) => (zone === "ALL" ? true : j.zone === zone))
      .filter((j) => (level === "ALL" ? true : j.congestion_level === level))
      .filter((j) => (q ? j.name.toLowerCase().includes(q) : true))
      .sort((a, b) => b.avg_vehicle_count - a.avg_vehicle_count);
  }, [junctions, query, zone, level]);

  return (
    <div className="panel flex h-full min-h-0 flex-col p-3">
      <div className="flex items-baseline justify-between">
        <p className="meta-label">Signals monitored</p>
        <span className="numeric text-sm">{junctions.length}</span>
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a signal…"
          className="h-9 pl-8 text-sm"
          aria-label="Search junctions"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {zones.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setZone(item)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-data ${
              zone === item
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {item === "ALL" ? "All zones" : item}
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {LEVELS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setLevel(item)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-data ${
              level === item
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {item === "ALL" ? "All traffic" : item}
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {loading
          ? Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))
          : filtered.map((junction) => {
              const active = junction.junction_id === selectedId;
              return (
                <button
                  key={junction.junction_id}
                  type="button"
                  onClick={() => onSelect(junction.junction_id)}
                  className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-data ${
                    active
                      ? "border-primary/50 bg-primary/10"
                      : "border-transparent hover:border-border hover:bg-surface/50"
                  }`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${DOT[junction.congestion_level] ?? DOT['LOW']}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{junction.name}</span>
                    <span className="block text-[10px] text-muted-foreground">{junction.zone}</span>
                  </span>
                  <span className="numeric text-xs">{junction.avg_vehicle_count}</span>
                </button>
              );
            })}
        {!loading && filtered.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No signals match those filters.</p>
        ) : null}
      </div>
    </div>
  );
}
