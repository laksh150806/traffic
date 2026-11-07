import { useEffect, useRef, useState } from "react";
import { SplitFlap } from "./SplitFlap";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+<>/\\|=";

/**
 * Start-up: a wall of glitching letters (the raw feed), with the system's checks clacking in on a
 * split-flap board. Each line is a real check of this session (junctions loaded, data source,
 * control loop). Once a session, skippable with any key or click, skipped with reduced motion.
 */
export function BootSequence({
  junctions,
  source,
  ready,
}: {
  junctions: number;
  source: string;
  ready: boolean;
}) {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem("argus-boot") === "1";
      sessionStorage.setItem("argus-boot", "1");
    } catch {
      /* storage blocked: show it */
    }
    if (!seen && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setShow(true);
  }, []);

  const lines = [
    "ARGUS ONLINE",
    `LINK ${String(junctions).padStart(2, "0")} JUNCTIONS`,
    `SOURCE ${source}`,
    "WEBSTER SOLVER ARMED",
    "EYE OPEN",
  ];

  useEffect(() => {
    if (!show) return;
    if (step < lines.length) {
      const id = window.setTimeout(() => setStep((s) => s + 1), step === 1 && !ready ? 900 : 420);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setLeaving(true), 500);
    const done = window.setTimeout(() => setShow(false), 1300);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(done);
    };
  }, [show, step, ready, lines.length]);

  useEffect(() => {
    if (!show) return;
    const skip = () => {
      setLeaving(true);
      window.setTimeout(() => setShow(false), 500);
    };
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [show]);

  // Letter glitch wall.
  useEffect(() => {
    const el = canvas.current;
    if (!show || !el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const size = 16;
    el.width = window.innerWidth;
    el.height = window.innerHeight;
    const cols = Math.ceil(el.width / size);
    const rows = Math.ceil(el.height / size);
    const grid = Array.from({ length: cols * rows }, () => ({
      c: GLYPHS[(Math.random() * GLYPHS.length) | 0]!,
      a: Math.random() * 0.4,
      red: Math.random() < 0.03,
    }));
    ctx.font = `12px "IBM Plex Mono", monospace`;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 50) return;
      last = now;
      ctx.clearRect(0, 0, el.width, el.height);
      for (let i = 0; i < grid.length; i++) {
        const g = grid[i]!;
        if (Math.random() < 0.05) {
          g.c = GLYPHS[(Math.random() * GLYPHS.length) | 0]!;
          g.a = Math.random() * 0.45;
        }
        ctx.fillStyle = g.red ? `rgba(229,72,77,${g.a + 0.2})` : `rgba(232,233,236,${g.a * 0.5})`;
        ctx.fillText(g.c, (i % cols) * size + 3, Math.floor(i / cols) * size + 12);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [show]);

  if (!show) return null;
  return (
    <div className={leaving ? "boot boot-leave" : "boot"} role="status" aria-label="Starting up">
      <canvas ref={canvas} className="boot-glitch" aria-hidden />
      <div className="boot-vignette" aria-hidden />
      <div className="boot-board">
        {lines.slice(0, step).map((line) => (
          <div key={line} className="boot-line">
            <span className="boot-ok" aria-hidden>
              ■
            </span>
            <SplitFlap text={line} pad={24} />
          </div>
        ))}
      </div>
      <p className="boot-skip">Any key to skip</p>
    </div>
  );
}
