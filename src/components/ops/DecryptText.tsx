import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#%/<>";

/**
 * Text that locks on: when the words change, each character scrambles and then settles left to
 * right. Used where the thing named has just changed (the selected junction), so the eye is drawn
 * to what is new. Screen readers get the real text at once; the scramble is hidden from them.
 */
export function DecryptText({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(text);
  const first = useRef(true);

  useEffect(() => {
    if (reduce || first.current) {
      first.current = false;
      setShown(text);
      return;
    }
    const start = performance.now();
    const total = Math.min(900, 280 + text.length * 22);
    let frame = 0;
    const tick = (now: number) => {
      const done = Math.min(1, (now - start) / total);
      const locked = Math.floor(done * text.length);
      setShown(
        text
          .split("")
          .map((ch, i) =>
            i < locked || ch === " " ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
          )
          .join(""),
      );
      if (done < 1) frame = requestAnimationFrame(tick);
      else setShown(text);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, reduce]);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
