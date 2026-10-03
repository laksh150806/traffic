import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { useReducedMotion } from "motion/react";
import type { GlFailReason } from "@/components/space/GlCanvas";
import type { JunctionSummary } from "@/lib/traffic-types";

const CityScape = lazy(() => import("./CityScape"));
const JunctionMap = lazy(() => import("@/components/traffic/JunctionMap"));

export type StageView = "city" | "street";

const FAIL_COPY: Record<GlFailReason, string> = {
  unsupported: "3D is not available on this device, so the street map is shown.",
  slow: "3D was slowing this device down, so the street map is shown.",
  "context-lost": "The graphics driver reset the 3D view, so the street map is shown.",
  error: "The 3D view hit a problem, so the street map is shown.",
};

function StageFallback({ label }: { label: string }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      role="status"
      aria-label={label}
    >
      <div className="relative h-40 w-40">
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,oklch(0.82_0.13_205/0.55),oklch(0.3_0.12_275/0.6)_55%,transparent_72%)] blur-[2px] signal-live" />
        <span className="absolute -inset-5 rounded-full border border-primary/25" />
        <span className="absolute -inset-10 rounded-full border border-nebula/20" />
      </div>
    </div>
  );
}

const LEGEND = [
  { label: "Free flowing", cls: "bg-signal-low" },
  { label: "Busy", cls: "bg-signal-moderate" },
  { label: "Jammed", cls: "bg-signal-high" },
];

/**
 * The hero. By default the network is a 3D glass city; the street map
 * is one click away for real geography. HUD content floats above either view.
 */
export function CityStage({
  junctions,
  selectedId,
  onSelect,
  loading,
  view,
  top,
  bottom,
}: {
  junctions: JunctionSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
  view: StageView;
  top?: ReactNode;
  bottom?: ReactNode;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const [glFailed, setGlFailed] = useState<GlFailReason | null>(null);

  // Going back to the city view is the retry.
  useEffect(() => {
    if (view === "street") setGlFailed(null);
  }, [view]);

  const streetMap = (
    <JunctionMap junctions={junctions} selectedId={selectedId} onSelect={onSelect} />
  );

  return (
    <div className="panel relative isolate flex flex-col overflow-hidden lg:block lg:h-full">
      <div className="relative isolate z-0 h-[380px] shrink-0 lg:absolute lg:inset-0 lg:h-auto">
        {loading ? (
          <StageFallback label="Loading the network" />
        ) : (
          <ClientOnly fallback={<StageFallback label="Preparing the view" />}>
            <Suspense fallback={<StageFallback label="Loading the view" />}>
              {view === "city" ? (
                <CityScape
                  junctions={junctions}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  reducedMotion={reducedMotion}
                  fallback={streetMap}
                  onFail={setGlFailed}
                />
              ) : (
                streetMap
              )}
            </Suspense>
          </ClientOnly>
        )}
      </div>

      <div className="hud pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto">{top}</div>
        <ul className="pointer-events-auto flex flex-wrap gap-2 text-xs text-foreground/90">
          {LEGEND.map((item) => (
            <li key={item.label} className="glass-chip flex items-center gap-1.5 px-3 py-1.5">
              <span className={`h-2 w-2 rounded-full ${item.cls} shadow-[0_0_8px_currentColor]`} />
              {item.label}
            </li>
          ))}
        </ul>
      </div>

      {view === "city" && glFailed ? (
        <p
          role="status"
          className="glass-chip pointer-events-none absolute left-1/2 top-[86px] z-10 max-w-[90%] -translate-x-1/2 rounded-2xl! px-3 py-1.5 text-center text-xs text-foreground/90"
        >
          {FAIL_COPY[glFailed]} Switch to the street map and back to try again.
        </p>
      ) : view === "city" ? (
        <p className="pointer-events-none absolute left-1/2 top-[86px] z-10 hidden -translate-x-1/2 text-xs text-muted-foreground/80 lg:block">
          Drag to rotate. Select a junction to focus it.
        </p>
      ) : null}

      <div className="hud pointer-events-none relative z-10 p-3 lg:absolute lg:inset-x-0 lg:bottom-0 lg:p-4">
        <div className="pointer-events-auto">{bottom}</div>
      </div>
    </div>
  );
}
