import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { sfx } from "@/components/fx/sound";
import { prefersReduced } from "./text";

/*
 * Page-wide effects mounted once by the shell: film overlay, target cursor, click sparks, the tab
 * title and favicon, a console greeting, fuse toasts, and the pixel wipe between pages.
 */

const finePointer = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

/** Scanlines, grain and a slow vertical sweep over everything. Pointer-transparent. */
export function FilmOverlay() {
  return (
    <div aria-hidden className="fx-film">
      <div className="fx-film-scan" />
      <div className="fx-film-grain" />
      <div className="fx-film-sweep" />
      <div className="fx-film-vignette" />
    </div>
  );
}

/** Target cursor: corner brackets that snap around whatever button or card is under the pointer. */
export function TargetCursor() {
  const box = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!finePointer() || prefersReduced()) return;
    const b = box.current;
    const d = dot.current;
    if (!b || !d) return;
    let target: Element | null = null;
    let frame = 0;
    let mx = -100;
    let my = -100;
    // Box glides toward its goal with a critically damped lerp; the dot is pinned to the pointer.
    const cur = { x: -100, y: -100, w: 28, h: 28 };
    const sel =
      "a, button, [role=button], [data-target], input, select, textarea, summary, [role=tab]";
    const paint = () => {
      frame = 0;
      d.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
      let gx = mx - 14;
      let gy = my - 14;
      let gw = 28;
      let gh = 28;
      if (target && target.isConnected) {
        const r = target.getBoundingClientRect();
        gx = r.left - 5;
        gy = r.top - 5;
        gw = r.width + 10;
        gh = r.height + 10;
        // Appear in place around a new control instead of flying across the screen to it.
        if (!b.classList.contains("is-locked")) Object.assign(cur, { x: gx, y: gy, w: gw, h: gh });
      }
      b.classList.toggle("is-locked", !!target);
      const k = 0.34;
      cur.x += (gx - cur.x) * k;
      cur.y += (gy - cur.y) * k;
      cur.w += (gw - cur.w) * k;
      cur.h += (gh - cur.h) * k;
      b.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
      b.style.width = `${cur.w}px`;
      b.style.height = `${cur.h}px`;
      const settling =
        Math.abs(gx - cur.x) + Math.abs(gy - cur.y) + Math.abs(gw - cur.w) + Math.abs(gh - cur.h) >
        0.6;
      if (settling) frame = requestAnimationFrame(paint);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const move = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
      const el = (e.target as Element | null)?.closest?.(sel) ?? null;
      target = el && (el as HTMLElement).offsetWidth < 520 ? el : null;
      kick();
    };
    const leave = () => b.classList.add("is-gone");
    const enter = () => b.classList.remove("is-gone");
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("scroll", kick, { passive: true });
    document.addEventListener("pointerleave", leave);
    document.addEventListener("pointerenter", enter);
    return () => {
      document.documentElement.classList.remove("fx-has-cursor");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("scroll", kick);
      document.removeEventListener("pointerleave", leave);
      document.removeEventListener("pointerenter", enter);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <>
      <div ref={box} aria-hidden className="fx-target">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>
      <div ref={dot} aria-hidden className="fx-target-dot" />
    </>
  );
}

/** Click spark: a short burst of amber lines from every click. */
export function ClickSpark() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || prefersReduced()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sparks: Array<{ x: number; y: number; a: number; t: number }> = [];
    let frame = 0;
    const size = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    size();
    window.addEventListener("resize", size);
    const draw = (now: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        if (!s) continue;
        const p = (now - s.t) / 420;
        if (p >= 1) {
          sparks.splice(i, 1);
          continue;
        }
        const e = 1 - (1 - p) ** 3;
        const r1 = 6 + e * 22;
        const r2 = r1 + 9 * (1 - p);
        ctx.strokeStyle = `rgba(255, 45, 120,${1 - p})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(s.a) * r1, s.y + Math.sin(s.a) * r1);
        ctx.lineTo(s.x + Math.cos(s.a) * r2, s.y + Math.sin(s.a) * r2);
        ctx.stroke();
      }
      frame = sparks.length ? requestAnimationFrame(draw) : 0;
    };
    const click = (e: MouseEvent) => {
      const t = performance.now();
      for (let i = 0; i < 9; i++)
        sparks.push({ x: e.clientX, y: e.clientY, a: (i / 9) * Math.PI * 2, t });
      if (!frame) frame = requestAnimationFrame(draw);
    };
    window.addEventListener("click", click);
    return () => {
      window.removeEventListener("click", click);
      window.removeEventListener("resize", size);
      cancelAnimationFrame(frame);
    };
  }, []);
  return <canvas ref={ref} aria-hidden className="fx-sparks" />;
}

/** Tab title that calls the operator back, and a favicon that sweeps like a radar. */
export function TabPresence({ jammed }: { jammed: number }) {
  const jammedRef = useRef(jammed);
  jammedRef.current = jammed;
  useEffect(() => {
    let saved = document.title;
    let blink = 0;
    const onVis = () => {
      if (document.hidden) {
        saved = document.title;
        let on = false;
        blink = window.setInterval(() => {
          on = !on;
          document.title = on
            ? `[${jammedRef.current}] JAMMED · console idle`
            : "SIGNAL OPS · come back, operator";
        }, 1500);
      } else {
        window.clearInterval(blink);
        document.title = saved;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(blink);
    };
  }, []);
  useEffect(() => {
    if (prefersReduced()) return;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!ctx) return;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    const original = link.href;
    let a = 0;
    const id = window.setInterval(() => {
      if (document.hidden && a > 0) return;
      a += 0.5;
      ctx.clearRect(0, 0, 32, 32);
      ctx.fillStyle = "#0a0b0c";
      ctx.fillRect(0, 0, 32, 32);
      ctx.strokeStyle = "#ff2d78";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(16, 16, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(16, 16);
      ctx.lineTo(16 + Math.cos(a) * 12, 16 + Math.sin(a) * 12);
      ctx.stroke();
      ctx.fillStyle = jammedRef.current > 0 ? "#ff4d3d" : "#3ddc84";
      ctx.beginPath();
      ctx.arc(23, 9, 4, 0, Math.PI * 2);
      ctx.fill();
      link!.href = canvas.toDataURL("image/png");
    }, 250);
    return () => {
      window.clearInterval(id);
      if (link) link.href = original;
    };
  }, []);
  return null;
}

let greeted = false;
/** A greeting for whoever opens the developer console. */
export function ConsoleGreeting() {
  useEffect(() => {
    if (greeted) return;
    greeted = true;
    console.log(
      "%c SIGNAL OPS %c Chennai adaptive signal console. Queues are modelled; no signal hardware is driven.",
      "background:#ff2d78;color:#0a0b0c;font:700 12px monospace;padding:3px 6px",
      "color:#ff2d78;font:12px monospace",
    );
  }, []);
  return null;
}

// ---- fuse toasts

type Toast = { id: number; text: string; tone: "ok" | "bad" | "info" };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
const emit = () => toastListeners.forEach((l) => l());
let nextToast = 1;

export function toast(text: string, tone: Toast["tone"] = "info") {
  const id = nextToast++;
  if (tone === "ok") sfx.ok();
  else if (tone === "bad") sfx.bad();
  else sfx.info();
  toasts = [...toasts, { id, text, tone }].slice(-4);
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 4200);
}

/** Toasts with a fuse that burns down to the moment they vanish. Swipe right to dismiss. */
export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );
  return (
    <div className="fx-toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <SwipeToast key={t.id} toast={t} />
      ))}
    </div>
  );
}

function SwipeToast({ toast: t }: { toast: Toast }) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(false);
  const start = useRef<number | null>(null);
  if (gone) return null;
  return (
    <div
      className={`fx-toast tone-${t.tone}`}
      style={{ transform: `translateX(${dx}px)`, opacity: 1 - Math.min(1, dx / 220) }}
      onPointerDown={(e) => {
        start.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => start.current !== null && setDx(Math.max(0, e.clientX - start.current))}
      onPointerUp={() => {
        if (dx > 90) setGone(true);
        else setDx(0);
        start.current = null;
      }}
    >
      <span className="fx-toast-tag">
        {t.tone === "bad" ? "ERR" : t.tone === "ok" ? "ACK" : "MSG"}
      </span>
      <span>{t.text}</span>
      <span aria-hidden className="fx-toast-fuse" />
    </div>
  );
}

/** Pixel transition: a grid of cells that wipes across when the page changes. */
export function PixelWipe({ trigger }: { trigger: string }) {
  const [key, setKey] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (prefersReduced()) return;
    setKey(trigger);
    const id = window.setTimeout(() => setKey(null), 700);
    return () => window.clearTimeout(id);
  }, [trigger]);
  if (!key) return null;
  const cols = 16;
  const rows = 9;
  return (
    <div
      aria-hidden
      className="fx-pixelwipe"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <i key={i} style={{ animationDelay: `${(i % cols) * 18 + ((i * 7919) % 97)}ms` }} />
      ))}
    </div>
  );
}

/** Marquee ticker: a looping strip of items (operator log). Pauses on hover. */
export function Ticker({ items, label }: { items: ReactNode[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <div className="fx-ticker" aria-label={label}>
      <div className="fx-ticker-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="fx-ticker-run" aria-hidden={copy === 1}>
            {items.map((item, i) => (
              <span key={i} className="fx-ticker-item">
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Crosshair over the map: hairlines and a coordinate readout that follow the pointer. */
export function Crosshair({
  toLatLng,
}: {
  toLatLng?: (x: number, y: number) => { lat: number; lng: number } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host || !finePointer()) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const b = host.getBoundingClientRect();
        const x = e.clientX - b.left;
        const y = e.clientY - b.top;
        el.style.setProperty("--cx", `${x}px`);
        el.style.setProperty("--cy", `${y}px`);
        el.classList.add("is-on");
        const ll = toLatLng?.(x, y);
        const label = el.querySelector("em");
        if (label)
          label.textContent = ll
            ? `${ll.lat.toFixed(4)}N ${ll.lng.toFixed(4)}E`
            : `${Math.round(x)}:${Math.round(y)}`;
      });
    };
    const leave = () => el.classList.remove("is-on");
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(frame);
    };
  }, [toLatLng]);
  return (
    <div ref={ref} aria-hidden className="fx-crosshair">
      <i className="h" />
      <i className="v" />
      <em />
    </div>
  );
}
