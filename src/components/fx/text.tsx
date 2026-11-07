import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

/*
 * Text effects. Every one keeps the real words available to screen readers and copy, and settles
 * to plain text when the visitor asks for reduced motion.
 */

const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#%/<>[]{}=+*";
const HEX = "0123456789ABCDEF";

export const prefersReduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const rand = (set: string) => set[Math.floor(Math.random() * set.length)] ?? "#";

/** Decrypted text: scrambles and locks left to right whenever `text` changes (and on mount). */
export function Decrypt({
  text,
  className,
  speed = 1,
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  speed?: number;
  as?: "span" | "h1" | "h2" | "h3" | "p";
}) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (prefersReduced()) return setShown(text);
    const start = performance.now();
    const total = Math.min(1100, 300 + text.length * 26) / speed;
    let frame = 0;
    const tick = (now: number) => {
      const done = Math.min(1, (now - start) / total);
      const locked = Math.floor(done * text.length);
      setShown(
        text
          .split("")
          .map((ch, i) => (i < locked || ch === " " ? ch : rand(GLYPHS)))
          .join(""),
      );
      if (done < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, speed]);
  return (
    <Tag className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{shown}</span>
    </Tag>
  );
}

/** Hyper text: scrambles once on hover or focus (nav labels). */
export function HyperText({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text);
  const frame = useRef(0);
  const run = () => {
    if (prefersReduced()) return;
    cancelAnimationFrame(frame.current);
    let step = 0;
    const tick = () => {
      step += 0.45;
      setShown(
        text
          .split("")
          .map((ch, i) => (i < step || ch === " " ? ch : rand(GLYPHS)))
          .join(""),
      );
      if (step < text.length) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <span className={className} onPointerEnter={run} onFocus={run}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}

/** Evervault-style scramble field: a block of hex that flickers under the pointer. Decorative. */
export function HexField({
  rows = 6,
  cols = 28,
  className = "",
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  // Same text on server and first client render (a fixed pattern), randomised after hydration.
  const [text, setText] = useState(() =>
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => HEX[(r * 7 + c * 13) % HEX.length]).join(""),
    ).join("\n"),
  );
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setText(
      Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => rand(HEX)).join(""),
      ).join("\n"),
    );
  }, [rows, cols]);
  useEffect(() => {
    if (prefersReduced()) return;
    const id = window.setInterval(
      () => {
        if (document.hidden) return;
        setText(
          Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => rand(HEX)).join(""),
          ).join("\n"),
        );
      },
      pos ? 70 : 900,
    );
    return () => window.clearInterval(id);
  }, [rows, cols, pos]);
  const style = pos ? ({ "--mx": `${pos.x}px`, "--my": `${pos.y}px` } as CSSProperties) : undefined;
  return (
    <pre
      ref={ref}
      aria-hidden
      className={`fx-hexfield ${pos ? "is-hot" : ""} ${className}`}
      style={style}
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        setPos({ x: e.clientX - box.left, y: e.clientY - box.top });
      }}
      onPointerLeave={() => setPos(null)}
    >
      {text}
    </pre>
  );
}

/** Rolling number: each digit is a column that rolls to its value. */
export function RollNumber({
  value,
  className = "",
  pad = 0,
}: {
  value: number | string;
  className?: string;
  pad?: number;
}) {
  const text = String(value).padStart(pad, "0");
  return (
    <span className={`fx-roll ${className}`} aria-label={text}>
      {text.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={`${i}-${text.length}`} className="fx-roll-col" aria-hidden>
            <span
              className="fx-roll-strip"
              style={{ transform: `translateY(-${Number(ch) * 10}%)` }}
            >
              {"0123456789".split("").map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={`${i}-${ch}`} aria-hidden>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

/** Circular text: words set on a slowly turning ring (around the clock). */
export function CircularText({
  text,
  size = 120,
  className = "",
}: {
  text: string;
  size?: number;
  className?: string;
}) {
  const id = `ct-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const r = size / 2 - 8;
  return (
    <svg
      aria-hidden
      className={`fx-circtext ${className}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      <defs>
        <path
          id={id}
          d={`M ${size / 2},${size / 2} m -${r},0 a ${r},${r} 0 1,1 ${r * 2},0 a ${r},${r} 0 1,1 -${r * 2},0`}
        />
      </defs>
      <text>
        <textPath href={`#${id}`} textLength={Math.floor(2 * Math.PI * r) - 4}>
          {text}
        </textPath>
      </text>
    </svg>
  );
}

/** Morphing text: words cross-fade through a blur so the system state "melts" into the next. */
export function MorphText({ text, className = "" }: { text: string; className?: string }) {
  const [pair, setPair] = useState({ now: text, was: "" });
  useEffect(() => {
    setPair((p) => (p.now === text ? p : { now: text, was: p.now }));
  }, [text]);
  return (
    <span className={`fx-morph ${className}`} aria-live="polite">
      <span key={`was-${pair.was}`} className="fx-morph-out" aria-hidden>
        {pair.was}
      </span>
      <span key={`now-${pair.now}`} className="fx-morph-in">
        {pair.now}
      </span>
    </span>
  );
}

/** Glitch text: RGB-split slices that jump every few seconds (login title, 404). */
export function GlitchText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`fx-glitch ${className}`} data-text={text}>
      {text}
    </span>
  );
}

/** Fuzzy text: a canvas copy of the words that shivers horizontally, harder under the pointer. */
export function FuzzyText({
  text,
  size = 140,
  className = "",
}: {
  text: string;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const font = `700 ${size}px "Chakra Petch", sans-serif`;
    const off = document.createElement("canvas");
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.font = font;
    const w = Math.ceil(octx.measureText(text).width) + 40;
    const h = Math.ceil(size * 1.2);
    off.width = w * dpr;
    off.height = h * dpr;
    octx.scale(dpr, dpr);
    octx.font = font;
    octx.fillStyle = "#ff2d78";
    octx.textBaseline = "middle";
    octx.fillText(text, 20, h / 2);
    canvas.width = (w + 60) * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w + 60}px`;
    canvas.style.height = `${h}px`;
    let hover = false;
    let frame = 0;
    const reduce = prefersReduced();
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const amp = reduce ? 0 : hover ? 26 : 7;
      for (let y = 0; y < off.height; y += 2) {
        const dx = Math.floor((Math.random() - 0.5) * amp * dpr);
        ctx.drawImage(off, 0, y, off.width, 2, 30 * dpr + dx, y, off.width, 2);
      }
      if (!reduce) frame = requestAnimationFrame(draw);
    };
    const enter = () => (hover = true);
    const leave = () => (hover = false);
    canvas.addEventListener("pointerenter", enter);
    canvas.addEventListener("pointerleave", leave);
    if ("fonts" in document) void document.fonts.ready.then(draw);
    else draw();
    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerenter", enter);
      canvas.removeEventListener("pointerleave", leave);
    };
  }, [text, size]);
  return <canvas ref={ref} role="img" aria-label={text} className={className} />;
}

/** Typewriter line for the log terminal. */
export function TypeLine({ text, className = "" }: { text: string; className?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prefersReduced()) return setN(text.length);
    setN(0);
    const id = window.setInterval(() => setN((v) => (v >= text.length ? v : v + 2)), 16);
    return () => window.clearInterval(id);
  }, [text]);
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{text.slice(0, n)}</span>
      {n < text.length ? <span aria-hidden className="fx-caret" /> : null}
    </span>
  );
}
