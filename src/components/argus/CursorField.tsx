import { useEffect, useRef } from "react";

/**
 * The pointer over the map, drawn as three layers on one canvas:
 *  - a grid of cells lights up behind the pointer and rings out on click (where you are on the table)
 *  - a soft glow trails it and cools
 *  - a swarm of particles follows it; over a junction the swarm takes that junction's congestion
 *    colour and draws in tight round it, so the swarm is a reading, not decoration.
 * Mouse only; off on touch screens and with reduced motion. Rests when the pointer is still.
 */
const CELL = 28;
const COUNT = 64;

export function CursorField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (
      window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const host = canvas.parentElement!;

    let w = 0;
    let h = 0;
    const resize = () => {
      const box = host.getBoundingClientRect();
      w = box.width;
      h = box.height;
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const p = { x: -999, y: -999, tx: -999, ty: -999, inside: false };
    let colour = "232,233,236";
    let lock = 0; // 0 loose, 1 gathered on a junction
    let lockTarget = 0;
    const cells = new Map<string, number>();
    const rings: Array<{ x: number; y: number; r: number; a: number }> = [];
    const swarm = Array.from({ length: COUNT }, (_, i) => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      phase: (i / COUNT) * Math.PI * 2,
      orbit: 10 + (i % 8) * 4,
    }));
    let lastMove = 0;
    let raf = 0;
    let running = false;

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const box = host.getBoundingClientRect();
      p.tx = event.clientX - box.left;
      p.ty = event.clientY - box.top;
      p.inside = p.tx >= 0 && p.ty >= 0 && p.tx <= w && p.ty <= h;
      if (p.x < -900) {
        p.x = p.tx;
        p.y = p.ty;
        for (const s of swarm) {
          s.x = p.x;
          s.y = p.y;
        }
      }
      // A junction dot is an SVG path whose fill is its congestion colour.
      const target = event.target as Element | null;
      const fill =
        target instanceof SVGPathElement && target.classList.contains("leaflet-interactive")
          ? getComputedStyle(target).fill
          : null;
      const rgb = fill?.match(/\d+(\.\d+)?/g);
      if (rgb && rgb.length >= 3 && fill !== "none") {
        colour = rgb.slice(0, 3).join(",");
        lockTarget = 1;
      } else {
        colour = "232,233,236";
        lockTarget = 0;
      }
      if (p.inside) {
        const key = `${Math.floor(p.tx / CELL)},${Math.floor(p.ty / CELL)}`;
        cells.set(key, 1);
      }
      lastMove = performance.now();
      if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !p.inside) return;
      rings.push({ x: p.tx, y: p.ty, r: 4, a: 1 });
      onMove(event);
    };

    const frame = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      p.x += (p.tx - p.x) * 0.22;
      p.y += (p.ty - p.y) * 0.22;
      lock += (lockTarget - lock) * 0.12;

      if (p.inside) {
        // grid: lit cells near the pointer, fading
        ctx.lineWidth = 1;
        for (const [key, a] of cells) {
          const [cx, cy] = key.split(",").map(Number) as [number, number];
          ctx.strokeStyle = `rgba(${colour},${a * 0.28})`;
          ctx.strokeRect(cx * CELL + 0.5, cy * CELL + 0.5, CELL - 1, CELL - 1);
          ctx.fillStyle = `rgba(${colour},${a * 0.035})`;
          ctx.fillRect(cx * CELL + 1, cy * CELL + 1, CELL - 2, CELL - 2);
          const next = a - 0.03;
          if (next <= 0) cells.delete(key);
          else cells.set(key, next);
        }
        // glow
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 120);
        g.addColorStop(0, `rgba(${colour},${0.1 + lock * 0.08})`);
        g.addColorStop(1, `rgba(${colour},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(p.x - 120, p.y - 120, 240, 240);
      }

      // swarm: each particle chases a point on its own orbit round the pointer; with a junction
      // under the pointer the orbits shrink so the swarm closes in on it.
      const t = now / 1000;
      ctx.fillStyle = `rgba(${colour},0.85)`;
      for (const s of swarm) {
        const r = s.orbit * (1 - lock * 0.55) + Math.sin(t * 2 + s.phase * 3) * 4;
        const ang = s.phase + t * (1.2 + lock * 2.4) * (s.orbit % 8 < 4 ? 1 : -1);
        const gx = p.x + Math.cos(ang) * r;
        const gy = p.y + Math.sin(ang) * r;
        s.vx = (s.vx + (gx - s.x) * 0.06) * 0.8;
        s.vy = (s.vy + (gy - s.y) * 0.06) * 0.8;
        s.x += s.vx;
        s.y += s.vy;
        const size = 0.8 + lock * 0.6;
        if (p.inside) ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
      }

      // click rings
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i]!;
        ring.r += 3.2;
        ring.a -= 0.035;
        if (ring.a <= 0) {
          rings.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = `rgba(${colour},${ring.a * 0.8})`;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      const idle = now - lastMove > 1400 && cells.size === 0 && rings.length === 0;
      if (idle || document.hidden) {
        running = false;
        if (!p.inside) ctx.clearRect(0, 0, w, h);
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-[7]" />;
}
