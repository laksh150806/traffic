import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import type { JunctionSummary } from "@/lib/traffic-data";

const JunctionMap = lazy(() => import("./JunctionMap"));

type Props = {
  junctions: JunctionSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
};

function MapFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface/40">
      <Skeleton className="h-full w-full rounded-none opacity-40" />
    </div>
  );
}

export function MapPanel({ junctions, selectedId, onSelect, loading }: Props) {
  return (
    <div className="relative h-[320px] overflow-hidden panel lg:h-full lg:rounded-none lg:border-0 lg:border-r lg:shadow-none">
      {loading ? (
        <MapFallback />
      ) : (
        <ClientOnly fallback={<MapFallback />}>
          <Suspense fallback={<MapFallback />}>
            <JunctionMap junctions={junctions} selectedId={selectedId} onSelect={onSelect} />
          </Suspense>
        </ClientOnly>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-wrap gap-3 rounded-md border border-border bg-card/90 px-3 py-2 backdrop-blur">
        <span className="meta-label">Congestion</span>
        {[
          { label: "Low", cls: "bg-signal-low" },
          { label: "Moderate", cls: "bg-signal-moderate" },
          { label: "High", cls: "bg-signal-high" },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${item.cls}`} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
