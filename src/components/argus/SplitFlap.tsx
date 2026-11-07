import { useEffect, useRef, useState } from "react";

const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:·%-+./";

/**
 * A departures-board readout: when the text changes, each cell clacks through the drum to its new
 * character, left to right. Used for readings that change (names, counts, the clock), so the motion
 * itself says "this just changed".
 */
export function SplitFlap({
  text,
  className = "",
  pad = 0,
  label,
}: {
  text: string;
  className?: string;
  /** Minimum number of cells, so the board does not jump in width. */
  pad?: number;
  /** Screen readers hear this instead of the cells. */
  label?: string;
}) {
  const target = text.toUpperCase().padEnd(pad, " ");
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const timer = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      current.current = target;
      setShown(target);
      return;
    }
    let frame = 0;
    const step = () => {
      frame += 1;
      const from = current.current.padEnd(target.length, " ").slice(0, target.length);
      let done = true;
      let next = "";
      for (let i = 0; i < target.length; i++) {
        const want = target[i] ?? " ";
        const have = from[i] ?? " ";
        // Each cell starts a beat after its left neighbour.
        if (have === want || frame < i * 0.6) {
          next += have;
          if (have !== want) done = false;
          continue;
        }
        const at = DRUM.indexOf(have);
        const goal = DRUM.indexOf(want);
        if (at < 0 || goal < 0) {
          next += want;
          continue;
        }
        // Up to three flaps per tick, so a long trip round the drum still lands quickly.
        const dist = (goal - at + DRUM.length) % DRUM.length;
        next += DRUM[(at + Math.min(3, dist)) % DRUM.length];
        if (dist > 3) done = false;
      }
      // Never strand a cell mid-drum: past the frame budget, land on the target.
      if (frame >= 80) next = target;
      current.current = next;
      setShown(next);
      if (!done && frame < 80) timer.current = window.setTimeout(step, 38);
    };
    timer.current = window.setTimeout(step, 38);
    return () => window.clearTimeout(timer.current);
  }, [target]);

  return (
    <span className={`flap-board ${className}`} aria-label={label ?? text} role="text">
      {shown.split("").map((char, i) => (
        <span key={i} className="flap-cell" aria-hidden>
          {/* key on the char re-runs the flip animation on every change */}
          <span key={char} className="flap-char">
            {char === " " ? " " : char}
          </span>
        </span>
      ))}
    </span>
  );
}
