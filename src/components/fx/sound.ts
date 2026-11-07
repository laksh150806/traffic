/**
 * Tiny synthesized UI sounds (WebAudio, no files). Quiet by design: a console, not an arcade.
 * The context starts on the first user gesture (browser autoplay rule); mute persists per browser.
 */
type Tone = { f: number; to?: number; d: number; type?: OscillatorType; g?: number; at?: number };

const KEY = "ops-sfx-muted";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
const listeners = new Set<(m: boolean) => void>();

try {
  muted = typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
} catch {
  muted = false;
}

function audio() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = 0.16;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function play(tones: Tone[]) {
  if (muted) return;
  const c = audio();
  if (!c || !master || c.state !== "running") return;
  const now = c.currentTime;
  for (const t of tones) {
    const start = now + (t.at ?? 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = t.type ?? "sine";
    osc.frequency.setValueAtTime(t.f, start);
    if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.d);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(t.g ?? 0.5, start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, start + t.d);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + t.d + 0.02);
  }
}

let lastHover = 0;
export const sfx = {
  hover() {
    const n = performance.now();
    if (n - lastHover < 45) return;
    lastHover = n;
    play([{ f: 2400, d: 0.025, type: "sine", g: 0.08 }]);
  },
  click: () => play([{ f: 1400, to: 900, d: 0.05, type: "triangle", g: 0.35 }]),
  nav: () =>
    play([
      { f: 300, to: 900, d: 0.16, type: "sine", g: 0.22 },
      { f: 1800, d: 0.04, type: "triangle", g: 0.12, at: 0.12 },
    ]),
  ok: () =>
    play([
      { f: 880, d: 0.07, type: "triangle", g: 0.3 },
      { f: 1320, d: 0.11, type: "triangle", g: 0.3, at: 0.07 },
    ]),
  bad: () =>
    play([
      { f: 220, d: 0.12, type: "square", g: 0.12 },
      { f: 165, d: 0.18, type: "square", g: 0.12, at: 0.11 },
    ]),
  info: () => play([{ f: 1046, d: 0.08, type: "sine", g: 0.25 }]),
  /** Rising charge while a hold button fills; returns a stop function. */
  charge(ms: number) {
    if (muted) return () => {};
    const c = audio();
    if (!c || !master || c.state !== "running") return () => {};
    const osc = c.createOscillator();
    const g = c.createGain();
    const now = c.currentTime;
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + ms / 1000);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.05, now + 0.05);
    osc.connect(g).connect(master);
    osc.start(now);
    return () => {
      const t = c.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.stop(t + 0.06);
    };
  },
};

export function isMuted() {
  return muted;
}
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? "1" : "0");
  } catch {
    /* storage blocked: mute lasts this tab only */
  }
  listeners.forEach((fn) => fn(m));
  if (!m) sfx.ok();
}
export function onMuteChange(fn: (m: boolean) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

const INTERACTIVE =
  "a, button, [role=button], [role=radio], [role=tab], select, summary, [data-target]";

/** Wires hover ticks and click blips onto every control in the document. Call once. */
export function installUiSounds() {
  if (typeof window === "undefined") return () => {};
  let hovered: Element | null = null;
  const unlock = () => audio();
  const down = (e: PointerEvent) => {
    unlock();
    const el = (e.target as Element | null)?.closest?.(INTERACTIVE);
    if (el && !(el as HTMLButtonElement).disabled && !el.closest("[data-sfx=off]")) sfx.click();
  };
  const over = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = (e.target as Element | null)?.closest?.(INTERACTIVE) ?? null;
    if (el !== hovered) {
      hovered = el;
      if (el && !(el as HTMLButtonElement).disabled) sfx.hover();
    }
  };
  const key = (e: KeyboardEvent) => {
    unlock();
    if (e.key === "Enter" || e.key === " ") {
      const el = (e.target as Element | null)?.closest?.(INTERACTIVE);
      if (el) sfx.click();
    }
  };
  window.addEventListener("pointerdown", down, { passive: true, capture: true });
  window.addEventListener("pointerover", over, { passive: true });
  window.addEventListener("keydown", key, { capture: true });
  return () => {
    window.removeEventListener("pointerdown", down, { capture: true });
    window.removeEventListener("pointerover", over);
    window.removeEventListener("keydown", key, { capture: true });
  };
}
