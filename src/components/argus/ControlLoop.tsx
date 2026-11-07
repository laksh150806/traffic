import { useEffect, useState } from "react";

/**
 * The control loop as it actually runs, one stage lit at a time:
 *  Sense  readings land (every 12 s)
 *  Solve  Webster splits re-solved for all junctions (same tick)
 *  Switch green phases end and hand over (every 2 s)
 *  Hold   waiting for the next reading
 * Driven by the real timers: `lastUpdated` changes on each reading, `busy` while the tick runs.
 */
const STAGES = [
  { id: "sense", label: "Sense", note: "readings land" },
  { id: "solve", label: "Solve", note: "green splits re-solved" },
  { id: "switch", label: "Switch", note: "phases hand over, 2 s" },
  { id: "hold", label: "Hold", note: "next reading" },
] as const;

export function ControlLoop({ busy, lastUpdated }: { busy: boolean; lastUpdated: string | null }) {
  const [since, setSince] = useState(0);
  useEffect(() => {
    setSince(0);
    const started = Date.now();
    const id = window.setInterval(() => setSince((Date.now() - started) / 1000), 500);
    return () => window.clearInterval(id);
  }, [lastUpdated]);

  const active = busy ? 1 : since < 1.5 ? 0 : since < 9 ? 2 : 3;
  const left = Math.max(0, Math.ceil(12 - since));

  return (
    <section aria-label="Control loop" className="loop">
      <h2 className="rail-head">Control loop</h2>
      <ol className="loop-steps">
        {STAGES.map((s, i) => (
          <li
            key={s.id}
            data-on={i === active ? "" : undefined}
            data-done={i < active ? "" : undefined}
          >
            <span className="loop-node" aria-hidden />
            <span className="loop-label">{s.label}</span>
            <span className="loop-note">{i === 3 && i === active ? `in ${left} s` : s.note}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
