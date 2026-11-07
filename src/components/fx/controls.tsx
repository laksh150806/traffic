import { sfx } from "@/components/fx/sound";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from "react";
import { prefersReduced } from "./text";

/*
 * Controls with weight. Commands that change a real signal need a deliberate gesture (hold, slide)
 * so they cannot fire on a stray click; each still works from the keyboard.
 */

/** Hold button: press and hold for `ms` to fire. Keyboard: hold Enter or Space. */
export function HoldButton({
  onHold,
  children,
  ms = 1200,
  disabled,
  tone = "amber",
  className = "",
}: {
  onHold: () => void;
  children: ReactNode;
  ms?: number;
  disabled?: boolean;
  tone?: "amber" | "red" | "green";
  className?: string;
}) {
  // Progress lives in a CSS variable written straight to the element: no React render per frame.
  const [firedView, setFiredView] = useState(false);
  const el = useRef<HTMLButtonElement>(null);
  const start = useRef(0);
  const frame = useRef(0);
  const fired = useRef(false);
  const stopCharge = useRef<() => void>(() => {});
  const setP = (v: number) => el.current?.style.setProperty("--p", String(v));
  const begin = () => {
    if (disabled) return;
    fired.current = false;
    start.current = performance.now();
    stopCharge.current = sfx.charge(ms);
    const tick = (now: number) => {
      const v = Math.min(1, (now - start.current) / ms);
      setP(v);
      if (v >= 1) {
        stopCharge.current();
        if (!fired.current) {
          fired.current = true;
          setFiredView(true);
          sfx.ok();
          onHold();
        }
        window.setTimeout(() => {
          setP(0);
          setFiredView(false);
        }, 350);
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const end = () => {
    cancelAnimationFrame(frame.current);
    stopCharge.current();
    stopCharge.current = () => {};
    if (!fired.current) setP(0);
  };
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      stopCharge.current();
    },
    [],
  );
  return (
    <button
      ref={el}
      type="button"
      disabled={disabled}
      data-sfx="off"
      className={`fx-hold tone-${tone} ${firedView ? "is-fired" : ""} ${className}`}
      style={{ ["--p" as string]: "0" } as CSSProperties}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerLeave={end}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") end();
      }}
    >
      <span className="fx-hold-fill" aria-hidden />
      <svg className="fx-hold-ring" viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="18" r="15" pathLength="1" />
      </svg>
      <span className="fx-hold-label">{children}</span>
      <span className="sr-only">(press and hold)</span>
    </button>
  );
}

/** Slide to commit: drag the thumb to the end. Keyboard: focus the thumb and press Enter twice. */
export function SlideCommit({
  label,
  onCommit,
  disabled,
  className = "",
}: {
  label: string;
  onCommit: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const drag = useRef<{ start: number; max: number } | null>(null);
  const finish = () => {
    setDone(true);
    onCommit();
    window.setTimeout(() => {
      setDone(false);
      setX(0);
      setArmed(false);
    }, 1400);
  };
  return (
    <div
      ref={track}
      className={`fx-slide ${done ? "is-done" : ""} ${disabled ? "is-off" : ""} ${className}`}
    >
      <span className="fx-slide-fill" style={{ width: x + 44 }} aria-hidden />
      <span className="fx-slide-text" aria-hidden>
        {done ? "Committed" : armed ? "Press Enter again to confirm" : label}
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label}. Drag right, or press Enter twice.`}
        className="fx-slide-thumb"
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
          if (disabled || !track.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { start: e.clientX - x, max: track.current.clientWidth - 48 };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setX(Math.max(0, Math.min(drag.current.max, e.clientX - drag.current.start)));
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          const reached = x >= drag.current.max - 4;
          drag.current = null;
          if (reached) finish();
          else setX(0);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (armed) finish();
          else setArmed(true);
        }}
        onBlur={() => setArmed(false)}
      >
        <span aria-hidden>{"›››"}</span>
      </button>
    </div>
  );
}

/** Scrub field: drag sideways on the label to change the number; arrows nudge; or type. */
export function ScrubField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  const id = useId();
  const drag = useRef<{ x: number; v: number } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  return (
    <div className="fx-scrub">
      <label
        htmlFor={id}
        className="fx-scrub-label"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, v: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          onChange(clamp(drag.current.v + ((e.clientX - drag.current.x) / 6) * step));
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <span aria-hidden className="fx-scrub-grip">
          {"⟷"}
        </span>
        {label}
      </label>
      <span className="fx-scrub-box">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
        />
        {unit ? <em>{unit}</em> : null}
      </span>
      <span className="fx-scrub-meter" aria-hidden>
        <i style={{ width: `${((value - min) / Math.max(1, max - min)) * 100}%` }} />
      </span>
    </div>
  );
}

/** Button with a beam of light travelling round its border while `active` (or always). */
export function BeamButton({
  children,
  className = "",
  active = true,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button type="button" {...rest} className={`fx-beam ${active ? "is-on" : ""} ${className}`}>
      <span className="fx-beam-ring" aria-hidden />
      <span className="fx-beam-body">{children}</span>
    </button>
  );
}

/** Distorted button: SVG turbulence shakes the face on hover. For destructive actions. */
export function DistortButton({
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const id = useId().replace(/:/g, "");
  return (
    <>
      <svg width="0" height="0" aria-hidden className="absolute">
        <filter id={`d-${id}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.4" numOctaves="1" seed="3">
            <animate attributeName="seed" values="1;6;2;9;4" dur="0.5s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="9" />
        </filter>
      </svg>
      <button
        type="button"
        {...rest}
        className={`fx-distort ${className}`}
        style={{ ["--fx-filter" as string]: `url(#d-${id})` } as CSSProperties}
      >
        {children}
      </button>
    </>
  );
}

/** Electric border: a crackling animated SVG outline (critical incidents). */
export function ElectricBorder({
  children,
  className = "",
  color = "#ff4d3d",
}: {
  children: ReactNode;
  className?: string;
  color?: string;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <div
      className={`fx-electric ${className}`}
      style={{ ["--ec" as string]: color } as CSSProperties}
    >
      <svg aria-hidden className="fx-electric-svg" preserveAspectRatio="none">
        <defs>
          <filter id={`e-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="turbulence"
              baseFrequency="0.035"
              numOctaves="2"
              result="n"
              seed="2"
            >
              {prefersReduced() ? null : (
                <animate
                  attributeName="baseFrequency"
                  values="0.03;0.045;0.03"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
              )}
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="n" scale="5" />
          </filter>
        </defs>
        <rect x="3" y="3" rx="6" className="fx-electric-rect" filter={`url(#e-${id})`} />
      </svg>
      {children}
    </div>
  );
}

/** Input whose underline draws in from the left on focus, with a corner tick. */
export function LineInput({
  label,
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <div className={`fx-line ${className}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} {...rest} />
      <span aria-hidden className="fx-line-draw" />
    </div>
  );
}

/** Spotlight card: a soft radial light follows the pointer across the surface. */
export function Spotlight({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`fx-spot ${className}`}
      onPointerMove={(e) => {
        const b = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--sx", `${e.clientX - b.left}px`);
        e.currentTarget.style.setProperty("--sy", `${e.clientY - b.top}px`);
      }}
    >
      {children}
    </div>
  );
}

/** Holo card: tilts toward the pointer with a glare and a rainbow-free amber foil sheen. */
export function HoloCard({
  children,
  className = "",
  hot,
}: {
  children: ReactNode;
  className?: string;
  hot?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reset = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--gx", "50%");
    el.style.setProperty("--gy", "0%");
  };
  return (
    <div
      ref={ref}
      className={`fx-holo ${hot ? "is-hot" : ""} ${className}`}
      onPointerMove={(e) => {
        if (e.pointerType === "touch" || prefersReduced()) return;
        const b = e.currentTarget.getBoundingClientRect();
        const px = (e.clientX - b.left) / b.width;
        const py = (e.clientY - b.top) / b.height;
        e.currentTarget.style.setProperty("--rx", `${(0.5 - py) * 10}deg`);
        e.currentTarget.style.setProperty("--ry", `${(px - 0.5) * 12}deg`);
        e.currentTarget.style.setProperty("--gx", `${px * 100}%`);
        e.currentTarget.style.setProperty("--gy", `${py * 100}%`);
      }}
      onPointerLeave={reset}
    >
      <div className="fx-holo-inner">
        {children}
        <span aria-hidden className="fx-holo-foil" />
        <span aria-hidden className="fx-holo-glare" />
      </div>
    </div>
  );
}
