import { useRef, useState, type PointerEvent } from "react";

const GLYPHS = "#%/\\|<>[]{}=+*01";

/**
 * A heading that turns into wireframe under the pointer: letters near the cursor become dashed
 * outlines and flicker through code glyphs, then settle back. Text stays real text for
 * screen readers, search and copy.
 */
export function TechText({
  text,
  as: Tag = "span",
  className = "",
}: {
  text: string;
  as?: "span" | "h1" | "h2" | "h3";
  className?: string;
}) {
  const [hot, setHot] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const ref = useRef<HTMLElement>(null);

  const onMove = (event: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el || event.pointerType === "touch") return;
    const box = el.getBoundingClientRect();
    const share = (event.clientX - box.left) / Math.max(1, box.width);
    setHot(Math.round(share * (text.length - 1)));
    setTick((n) => n + 1);
  };

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className={`tech-text ${className}`}
      onPointerMove={onMove}
      onPointerLeave={() => setHot(null)}
      aria-label={text}
    >
      {text.split("").map((char, i) => {
        const near = hot !== null && Math.abs(i - hot) <= 2 && char !== " ";
        const glyph =
          near && Math.abs(i - hot!) === 0 ? GLYPHS[(i * 7 + tick) % GLYPHS.length] : char;
        return (
          <span key={i} aria-hidden className={near ? "tech-wire" : undefined}>
            {char === " " ? " " : glyph}
          </span>
        );
      })}
    </Tag>
  );
}
