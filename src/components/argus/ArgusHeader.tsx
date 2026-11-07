import { useEffect, useState } from "react";
import type { DataMode } from "@/lib/data-mode";
import type { LiveTraffic } from "@/components/ops/useLiveTraffic";
import { formatIstTime } from "@/lib/forecast";
import { SplitFlap } from "./SplitFlap";
import { TechText } from "./TechText";

function ago(iso: string | null) {
  if (!iso) return "--";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}S AGO` : `${Math.round(s / 60)}M AGO`;
}

/** The top strip: name, what the eye is doing, where the data comes from, the clock, the keys. */
export function ArgusHeader({
  mode,
  liveTraffic,
  trafficDriving,
  lastUpdated,
  state,
  busy,
  onRecalculate,
  onShare,
  shareLabel,
  onExport,
  onStartTour,
  tourPlaying,
}: {
  mode: DataMode;
  liveTraffic: LiveTraffic;
  trafficDriving: boolean;
  lastUpdated: string | null;
  /** One or two words for what the system is doing now. */
  state: string;
  busy: boolean;
  onRecalculate: () => void;
  onShare: () => void;
  shareLabel: string;
  onExport: () => void;
  onStartTour?: () => void;
  tourPlaying?: boolean;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const real = liveTraffic.status === "live" || liveTraffic.status === "stale" ? liveTraffic : null;
  const source = real
    ? real.status === "stale"
      ? "TomTom, last reading kept"
      : trafficDriving
        ? "TomTom live speeds"
        : "Scenario in charge"
    : mode === "simulated"
      ? "Simulated demand"
      : "Supabase, simulated readings";
  const stamp = real ? new Date(real.snapshot.fetchedAtMs).toISOString() : lastUpdated;

  return (
    <header className="argus-bar relative z-[600] flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 md:px-6 lg:absolute lg:inset-x-0 lg:top-0">
      <div className="flex items-baseline gap-4">
        <TechText as="h1" text="ARGUS" className="argus-word" />
        <span className="hidden text-[0.68rem] uppercase tracking-[0.28em] text-muted-foreground md:inline">
          Chennai signal intelligence
        </span>
      </div>
      <SplitFlap text={state} pad={12} className="flap-sm hidden sm:inline-flex" />

      <div className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="argus-key" title="Where the traffic readings come from">
          <span
            className={`h-1.5 w-1.5 rounded-full ${real?.status === "live" ? "bg-signal-low" : real ? "bg-signal-moderate" : "bg-[var(--stark-red)]"}`}
          />
          {source}
        </span>
        <span className="argus-key hidden lg:inline-flex" title="Last reading">
          Read <b className="numeric">{ago(stamp)}</b>
        </span>
        <SplitFlap
          text={`${formatIstTime(now).replace(/\s?(am|pm)/i, "")} IST`}
          pad={9}
          className="flap-sm"
          label={`${formatIstTime(now)} India time`}
        />
        <button type="button" className="argus-key hidden md:inline-flex" onClick={onShare}>
          <span aria-live="polite">{shareLabel}</span>
        </button>
        <button type="button" className="argus-key hidden md:inline-flex" onClick={onExport}>
          Export CSV
        </button>
        {onStartTour ? (
          <button type="button" className="argus-key" onClick={onStartTour} disabled={tourPlaying}>
            {tourPlaying ? "Tour running" : "Tour"}
          </button>
        ) : null}
        <button
          type="button"
          className="argus-key argus-key-hot"
          onClick={onRecalculate}
          disabled={busy}
        >
          {busy ? "Solving" : "Recalculate"}
        </button>
      </div>
    </header>
  );
}
