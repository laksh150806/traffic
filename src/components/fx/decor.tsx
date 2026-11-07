import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { prefersReduced } from "./text";

/*
 * HUD instruments. Some carry live readings (radar, node rack, oscilloscope fed by load); some are
 * pure instrument-panel dressing. Every canvas caps its pixel ratio, pauses when off screen or in a
 * hidden tab, and draws one still frame under reduced motion.
 */

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

export function useCanvasLoop(ref: RefObject<HTMLCanvasElement | null>, draw: Draw, fps = 30) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const size = () => {
      const box = canvas.getBoundingClientRect();
      w = Math.max(1, box.width);
      h = Math.max(1, box.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = Boolean(e?.isIntersecting)));
    io.observe(canvas);
    const reduce = prefersReduced();
    let frame = 0;
    let last = 0;
    const loop = (t: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible || document.hidden || t - last < 1000 / fps) return;
      last = t;
      drawRef.current(ctx, w, h, t / 1000);
    };
    if (reduce) drawRef.current(ctx, w, h, 0);
    else frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
    };
  }, [ref, fps]);
}

const AMBER = "255, 45, 120";
const RED = "255,77,61";
const GREEN = "61,220,132";

export type Blip = {
  id: number;
  bearing: number;
  dist: number;
  level: "LOW" | "MODERATE" | "HIGH";
  label?: string;
};

/** Radar sweep: junctions placed by bearing and distance from the city centre; jammed ones ping. */
export function Radar({
  blips,
  className = "",
  label,
}: {
  blips: Blip[];
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvasLoop(ref, (ctx, w, h, t) => {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - 4;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = `rgba(${AMBER},0.18)`;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (r * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    for (let d = 0; d < 360; d += 10) {
      const a = (d * Math.PI) / 180;
      const len = d % 30 === 0 ? 7 : 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.lineTo(cx + Math.cos(a) * (r - len), cy + Math.sin(a) * (r - len));
      ctx.stroke();
    }
    const sweep = (t * 1.1) % (Math.PI * 2);
    const grad = ctx.createConicGradient?.(sweep - 0.9, cx, cy);
    if (grad) {
      grad.addColorStop(0, `rgba(${AMBER},0)`);
      grad.addColorStop(0.14, `rgba(${AMBER},0.28)`);
      grad.addColorStop(0.145, `rgba(${AMBER},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of blips) {
      const a = ((b.bearing - 90) * Math.PI) / 180;
      const x = cx + Math.cos(a) * b.dist * r;
      const y = cy + Math.sin(a) * b.dist * r;
      const since = (sweep - ((a + Math.PI * 2) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const fade = Math.max(0.25, 1 - since / (Math.PI * 2));
      const rgb = b.level === "HIGH" ? RED : b.level === "MODERATE" ? AMBER : GREEN;
      ctx.fillStyle = `rgba(${rgb},${fade})`;
      ctx.beginPath();
      ctx.arc(x, y, b.level === "HIGH" ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
      if (b.level === "HIGH") {
        const ping = (t * 0.9 + b.id * 0.13) % 1;
        ctx.strokeStyle = `rgba(${RED},${1 - ping})`;
        ctx.beginPath();
        ctx.arc(x, y, 3 + ping * 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });
  return (
    <canvas
      ref={ref}
      className={`fx-canvas ${className}`}
      role="img"
      aria-label={label ?? "Radar of junction congestion"}
    />
  );
}

/** Flickering node rack: one cell per junction, lit by its level, with idle flicker. */
export function NodeRack({
  cells,
  className = "",
}: {
  cells: Array<"LOW" | "MODERATE" | "HIGH">;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvasLoop(
    ref,
    (ctx, w, h, t) => {
      ctx.clearRect(0, 0, w, h);
      const cols = Math.max(1, Math.ceil(Math.sqrt((cells.length || 1) * (w / h))));
      const rows = Math.max(1, Math.ceil((cells.length || 1) / cols));
      const cw = w / cols;
      const ch = h / rows;
      cells.forEach((level, i) => {
        const x = (i % cols) * cw;
        const y = Math.floor(i / cols) * ch;
        const flick = 0.55 + 0.45 * Math.abs(Math.sin(t * (1.3 + (i % 7) * 0.37) + i));
        const rgb = level === "HIGH" ? RED : level === "MODERATE" ? AMBER : GREEN;
        const base = level === "LOW" ? 0.22 : 0.75;
        ctx.fillStyle = `rgba(${rgb},${base * flick})`;
        ctx.fillRect(x + 1.5, y + 1.5, cw - 3, ch - 3);
      });
    },
    12,
  );
  return (
    <canvas
      ref={ref}
      className={`fx-canvas ${className}`}
      role="img"
      aria-label={`${cells.length} junction nodes`}
    />
  );
}

/** Oscilloscope: a live trace whose amplitude follows a reading (0-1). */
export function Scope({
  level,
  className = "",
  hue = "amber",
}: {
  level: number;
  className?: string;
  hue?: "amber" | "green" | "red";
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rgb = hue === "red" ? RED : hue === "green" ? GREEN : AMBER;
  useCanvasLoop(ref, (ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = `rgba(${AMBER},0.12)`;
    for (let x = 0; x < w; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(${rgb},0.95)`;
    ctx.shadowColor = `rgba(${rgb},0.8)`;
    ctx.shadowBlur = 6;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const amp = (0.15 + Math.min(1, level) * 0.8) * (h / 2 - 3);
    for (let x = 0; x <= w; x += 2) {
      const p = x / w;
      const y =
        h / 2 +
        Math.sin(p * 14 + t * 4) * amp * 0.6 +
        Math.sin(p * 31 - t * 7) * amp * 0.25 +
        (Math.random() - 0.5) * amp * 0.15;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  });
  return <canvas ref={ref} aria-hidden className={`fx-canvas ${className}`} />;
}

/** Letter glitch: a wall of code glyphs that re-roll in patches (login background). */
export function LetterGlitch({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const grid = useRef<{ ch: string[]; a: number[]; cols: number; rows: number }>({
    ch: [],
    a: [],
    cols: 0,
    rows: 0,
  });
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$&*()-_+=/[]{};:<>,";
  useCanvasLoop(
    ref,
    (ctx, w, h) => {
      const size = 16;
      const cols = Math.ceil(w / (size * 0.62));
      const rows = Math.ceil(h / size);
      const g = grid.current;
      if (g.cols !== cols || g.rows !== rows) {
        g.cols = cols;
        g.rows = rows;
        g.ch = Array.from(
          { length: cols * rows },
          () => chars[Math.floor(Math.random() * chars.length)] ?? "#",
        );
        g.a = Array.from({ length: cols * rows }, () => Math.random());
      }
      for (let k = 0; k < Math.max(8, (cols * rows) / 40); k++) {
        const i = Math.floor(Math.random() * g.ch.length);
        g.ch[i] = chars[Math.floor(Math.random() * chars.length)] ?? "#";
        g.a[i] = Math.random();
      }
      ctx.clearRect(0, 0, w, h);
      ctx.font = `${size - 3}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
      for (let i = 0; i < g.ch.length; i++) {
        const a = g.a[i] ?? 0;
        ctx.fillStyle = a > 0.97 ? `rgba(${RED},0.7)` : `rgba(${AMBER},${0.05 + a * 0.18})`;
        ctx.fillText(g.ch[i] ?? "", (i % cols) * size * 0.62, Math.floor(i / cols) * size);
      }
    },
    14,
  );
  return <canvas ref={ref} aria-hidden className={`fx-canvas ${className}`} />;
}

/** Magnet lines: a grid of short strokes that all turn to face the pointer. */
export function MagnetLines({
  rows = 7,
  cols = 9,
  className = "",
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced() || !window.matchMedia("(pointer: fine)").matches) return;
    const items = Array.from(el.querySelectorAll<HTMLSpanElement>("span"));
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const item of items) {
          const b = item.getBoundingClientRect();
          const a = Math.atan2(
            e.clientY - (b.top + b.height / 2),
            e.clientX - (b.left + b.width / 2),
          );
          item.style.transform = `rotate(${(a * 180) / Math.PI + 90}deg)`;
        }
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden
      className={`fx-magnet ${className}`}
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {Array.from({ length: rows * cols }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

/** HUD ring: concentric dashed rings turning at different speeds, with a tick bezel. */
export function HudRing({
  size = 160,
  className = "",
  children,
}: {
  size?: number;
  className?: string;
  children?: ReactNode;
}) {
  const ticks = Array.from({ length: 72 }, (_, i) => i);
  return (
    <div className={`fx-hudring ${className}`} style={{ width: size, height: size }}>
      <svg aria-hidden viewBox="0 0 200 200" className="fx-hudring-svg">
        <g className="fx-spin-slow">
          {ticks.map((i) => (
            <line
              key={i}
              x1="100"
              y1="4"
              x2="100"
              y2={i % 6 === 0 ? 14 : 9}
              transform={`rotate(${i * 5} 100 100)`}
              className={i % 6 === 0 ? "tick-major" : "tick"}
            />
          ))}
        </g>
        <circle cx="100" cy="100" r="80" className="ring-dash fx-spin-rev" />
        <circle cx="100" cy="100" r="70" className="ring-arc fx-spin-fast" />
        <circle cx="100" cy="100" r="58" className="ring-thin" />
        <path d="M100 30 A70 70 0 0 1 170 100" className="ring-hot fx-spin-med" />
      </svg>
      <div className="fx-hudring-core">{children}</div>
    </div>
  );
}

/** Corner brackets with coordinate ticks; wraps any panel. */
export function HudFrame({
  children,
  className = "",
  label,
  code,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  code?: string;
}) {
  return (
    <div className={`fx-frame ${className}`}>
      <i aria-hidden className="c tl" />
      <i aria-hidden className="c tr" />
      <i aria-hidden className="c bl" />
      <i aria-hidden className="c br" />
      {label ? (
        <div className="fx-frame-label">
          <span>{label}</span>
          {code ? <em>{code}</em> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Cubes: a small field of wireframe cubes that roll in sequence. Decorative. */
export function Cubes({ count = 9, className = "" }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={`fx-cubes ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="fx-cube"
          style={{ animationDelay: `${(i % 3) * 0.35 + Math.floor(i / 3) * 0.2}s` }}
        >
          {["f", "b", "l", "r", "t", "d"].map((s) => (
            <span key={s} className={`s-${s}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Retro perspective grid floor (login, 404). */
export function RetroGrid({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`fx-retrogrid ${className}`}>
      <div className="fx-retrogrid-plane" />
    </div>
  );
}

/** Lattice loader: a 3x3 lattice that pulses through its nodes. */
export function Lattice({
  label = "Loading",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span role="status" className={`fx-lattice ${className}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} style={{ animationDelay: `${((i % 3) + Math.floor(i / 3)) * 0.12}s` }} />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Status mark: an animated tick or cross, drawn on change. */
export function StatusMark({ ok, className = "" }: { ok: boolean; className?: string }) {
  return (
    <svg
      key={String(ok)}
      viewBox="0 0 24 24"
      className={`fx-status ${ok ? "ok" : "bad"} ${className}`}
      aria-label={ok ? "OK" : "Problem"}
    >
      <circle cx="12" cy="12" r="10" />
      {ok ? <path d="M7 12.5l3.2 3.2L17 9" /> : <path d="M8 8l8 8M16 8l-8 8" />}
    </svg>
  );
}

/** Spectrum bars: a strip of bars that breathe, scaled by a reading. */
export function Spectrum({
  level = 0.5,
  bars = 28,
  className = "",
}: {
  level?: number;
  bars?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`fx-spectrum ${className}`}
      style={{ ["--lvl" as string]: String(Math.max(0.15, Math.min(1, level))) }}
    >
      {Array.from({ length: bars }, (_, i) => (
        <i
          key={i}
          style={{
            animationDelay: `${-(i * 137) % 900}ms`,
            animationDuration: `${700 + ((i * 53) % 600)}ms`,
          }}
        />
      ))}
    </div>
  );
}

/** Hex stream: a column of memory-dump lines scrolling upward. */
export function HexStream({ lines = 14, className = "" }: { lines?: number; className?: string }) {
  const rows = Array.from({ length: lines * 2 }, (_, i) => {
    const addr = (0x7f3a00 + i * 16).toString(16).toUpperCase();
    const bytes = Array.from({ length: 6 }, (_, k) =>
      (((i + 3) * (k + 7) * 37) % 256).toString(16).padStart(2, "0").toUpperCase(),
    ).join(" ");
    return `${addr}  ${bytes}`;
  });
  return (
    <div aria-hidden className={`fx-hexstream ${className}`}>
      <div className="fx-hexstream-inner">
        {rows.map((r, i) => (
          <div key={i}>{r}</div>
        ))}
      </div>
    </div>
  );
}

/** Barcode/serial strip for panel footers. */
export function Serial({ code, className = "" }: { code: string; className?: string }) {
  const bars = code
    .split("")
    .flatMap((c, i) => [((c.charCodeAt(0) + i) % 3) + 1, ((c.charCodeAt(0) * 7 + i) % 2) + 1]);
  return (
    <span aria-hidden className={`fx-serial ${className}`}>
      <span className="fx-serial-bars">
        {bars.map((b, i) => (
          <i key={i} style={{ width: b, marginRight: i % 2 ? 2 : 1 }} />
        ))}
      </span>
      <em>{code}</em>
    </span>
  );
}
