import { useEffect, useState, type CSSProperties } from "react";
import { CloudMoon, Siren, SunMedium, Timer } from "lucide-react";
import {
  clearIncidents,
  getActiveIncidents,
  getScenarioMode,
  setScenarioMode,
  triggerIncident,
  type ScenarioMode,
} from "@/lib/demo-engine";

const MODES: Array<{ id: ScenarioMode; label: string; hint: string; icon: typeof Timer }> = [
  { id: "auto", label: "Time of day", hint: "Follows Chennai's clock", icon: Timer },
  { id: "rush", label: "Rush hour", hint: "Peak demand everywhere", icon: SunMedium },
  { id: "night", label: "Overnight", hint: "Light traffic", icon: CloudMoon },
];

/**
 * Demo-only controls. They change what the simulator feeds the signals so the
 * model's response can be watched live: that response is the point of the app.
 */
export function ScenarioPanel({
  junctionId,
  junctionName,
  onChange,
}: {
  junctionId: number | null;
  junctionName: string;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<ScenarioMode>("auto");
  const [incidents, setIncidents] = useState<number[]>([]);

  useEffect(() => {
    setMode(getScenarioMode());
    const read = () => setIncidents(getActiveIncidents());
    read();
    const id = window.setInterval(read, 2000);
    return () => window.clearInterval(id);
  }, []);

  const choose = (next: ScenarioMode) => {
    setScenarioMode(next);
    setMode(next);
    onChange();
  };

  const blocked = junctionId !== null && incidents.includes(junctionId);

  return (
    <section className="panel p-4">
      <h2 className="text-lg font-semibold">Scenario</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Change the demand the simulator feeds the signals, then watch the plan adapt.
      </p>

      <div
        role="group"
        aria-label="Demand level"
        className="glass-chip grid grid-cols-3 gap-1 rounded-2xl p-1"
      >
        {MODES.map(({ id, label, hint, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={hint}
            aria-pressed={mode === id}
            onClick={() => choose(id)}
            className={`transition-data flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-xs font-medium ${
              mode === id
                ? "bg-primary/20 text-primary shadow-[0_0_0_1px_oklch(0.82_0.13_205/0.4),0_6px_18px_-8px_var(--primary)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={junctionId === null || blocked}
          onClick={() => {
            if (junctionId === null) return;
            triggerIncident(junctionId);
            setIncidents(getActiveIncidents());
            onChange();
          }}
          style={{ "--tint": "var(--signal-high)" } as CSSProperties}
          className="glass-button inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold disabled:opacity-45"
        >
          <Siren className="h-3.5 w-3.5" />
          {blocked ? "Lane blocked" : `Block a lane at ${junctionName}`}
        </button>
        {incidents.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              clearIncidents();
              setIncidents([]);
              onChange();
            }}
            className="glass-chip transition-data px-3.5 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear {incidents.length} {incidents.length === 1 ? "incident" : "incidents"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
