import { PACES, type RunLauncher } from "@/components/ops/usePriorityRuns";

/** How fast a run is shown: real time, or faster so a long route can be watched. */
export function PaceSelect({ launcher }: { launcher: RunLauncher }) {
  return (
    <div
      role="group"
      aria-label="Speed of the run"
      className="flex items-center justify-between gap-2"
    >
      <span className="meta-label">Shown at</span>
      <div className="glass-chip flex gap-0.5 p-0.5">
        {PACES.map((pace) => (
          <button
            key={pace}
            type="button"
            aria-pressed={launcher.pace === pace}
            onClick={() => launcher.setPace(pace)}
            className={`transition-data min-h-8 rounded-full px-3 text-[11px] font-medium ${
              launcher.pace === pace
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {pace === 1 ? "Real time" : `${pace}×`}
          </button>
        ))}
      </div>
    </div>
  );
}
