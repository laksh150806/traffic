import { useEffect, useRef, useState } from "react";
import { ArgusEye, type EyeState } from "./ArgusEye";
import { SplitFlap } from "./SplitFlap";

/**
 * The eye docked over the map, with a tether that runs from its pupil to the junction it is
 * watching (the lock-on reticle). The eye's gaze follows the tether, so it looks at whatever you
 * select. Click the eye to give it an order (opens the command palette).
 */
export function EyeDock({
  state,
  reducedMotion,
  watching,
  readout,
  onOrder,
}: {
  state: Omit<EyeState, "gaze">;
  reducedMotion: boolean;
  watching: string | null;
  readout: string;
  onOrder: () => void;
}) {
  const dock = useRef<HTMLDivElement>(null);
  const [tether, setTether] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  );
  const [gaze, setGaze] = useState<[number, number]>([0, 0]);
  const SIZE = 132;

  // Follow the lock-on reticle while the map pans and flies.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const host = dock.current?.closest(".holo-table") as HTMLElement | null;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 60 || document.hidden) return;
      last = now;
      const eye = dock.current?.querySelector("canvas");
      const lock = host?.querySelector(".lock-on");
      if (!eye || !lock || !host) {
        setTether(null);
        return;
      }
      const h = host.getBoundingClientRect();
      const e = eye.getBoundingClientRect();
      const l = lock.getBoundingClientRect();
      const x1 = e.left + e.width / 2 - h.left;
      const y1 = e.top + e.height / 2 - h.top;
      const x2 = l.left + l.width / 2 - h.left;
      const y2 = l.top + l.height / 2 - h.top;
      setTether((t) =>
        t && Math.abs(t.x2 - x2) < 0.5 && Math.abs(t.y2 - y2) < 0.5 && Math.abs(t.x1 - x1) < 0.5
          ? t
          : { x1, y1, x2, y2 },
      );
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, len / 360);
      setGaze((g) => {
        const nx = (dx / len) * reach;
        const ny = (-dy / len) * reach;
        return Math.abs(g[0] - nx) < 0.01 && Math.abs(g[1] - ny) < 0.01 ? g : [nx, ny];
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      {tether ? (
        <svg
          className="eye-tether pointer-events-none absolute inset-0 z-[8] h-full w-full"
          aria-hidden
        >
          <defs>
            <linearGradient
              id="tether-fade"
              gradientUnits="userSpaceOnUse"
              x1={tether.x1}
              y1={tether.y1}
              x2={tether.x2}
              y2={tether.y2}
            >
              <stop offset="0" stopColor="#e8e9ec" stopOpacity="0" />
              <stop offset="0.25" stopColor="#e8e9ec" stopOpacity="0.55" />
              <stop offset="1" stopColor="#e5484d" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          <line {...tether} stroke="url(#tether-fade)" strokeWidth="1" className="tether-line" />
          <circle cx={tether.x2} cy={tether.y2} r="2.5" fill="#e5484d" />
        </svg>
      ) : null}
      <div
        ref={dock}
        className="eye-dock pointer-events-auto absolute left-1/2 z-[9] flex -translate-x-1/2 flex-col items-center"
      >
        <button
          type="button"
          onClick={onOrder}
          className="eye-button"
          aria-label="Give ARGUS an order (Ctrl K)"
          title="Give an order (Ctrl K)"
        >
          <span className="eye-socket" aria-hidden />
          <ArgusEye state={{ ...state, gaze }} size={SIZE} reducedMotion={reducedMotion} />
        </button>
        <div className="eye-readout">
          <SplitFlap text={readout} pad={18} className="flap-sm" />
          {watching ? (
            <span className="eye-watching">
              Watching <b>{watching}</b>
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}
