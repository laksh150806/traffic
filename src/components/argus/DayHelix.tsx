import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { forecastNetwork, istHourOf, minutesUntilIst, type ForecastOptions } from "@/lib/forecast";

const HOURS = 24;
const STEP = 360 / 18; // eighteen hours per turn, so the next nine hours face the viewer
const RISE = 24; // px per hour along the axis

/**
 * The next day as an endless spiral: one plate per hour wound round an axis, three turns a day,
 * and the spiral keeps turning into the next day as you scroll. Each plate is the model's forecast
 * for that hour across all junctions: how many jammed, how many busy. Drag or scroll to wind it;
 * pick a plate to send the map to that hour.
 */
// The rush factor is a live override for the present hour only; later hours use the model.
function withoutFactor({ factor: _factor, ...rest }: ForecastOptions): ForecastOptions {
  return rest;
}

export function DayHelix({
  base,
  options,
  onPick,
  currentHour,
}: {
  base: Date;
  options: ForecastOptions;
  onPick: (minutesAhead: number) => void;
  currentHour: number;
}) {
  const plates = useMemo(() => {
    const start = Math.floor(istHourOf(base));
    return Array.from({ length: HOURS }, (_, i) => {
      const hour = (start + i) % 24;
      const ahead = minutesUntilIst(base, hour, 5);
      const at = new Date(base.getTime() + ahead * 60_000);
      const all = forecastNetwork(at, i === 0 ? options : withoutFactor(options));
      const jammed = all.filter((f) => f.level === "HIGH").length;
      const busy = all.filter((f) => f.level === "MODERATE").length;
      const load = all.reduce((s, f) => s + f.saturation, 0) / Math.max(1, all.length);
      return { i, hour, ahead: i === 0 ? 0 : ahead, jammed, busy, load };
    });
  }, [base, options]);

  // How far the spiral is wound, in hours. Fractions are fine; plates wrap round endlessly.
  const [wind, setWind] = useState(0);
  const drag = useRef<{ y: number; w: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setWind((w) => w + event.deltaY / 120);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { y: event.clientY, w: wind };
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWind(drag.current.w + (drag.current.y - event.clientY) / RISE);
  };
  const onUp = () => {
    drag.current = null;
  };

  const peak = plates.reduce((a, b) => (b.jammed > a.jammed ? b : a), plates[0]!);

  return (
    <div className="space-y-2">
      <div
        ref={box}
        className="helix-stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        aria-label="The next 24 hours, scroll or drag to wind"
        role="group"
      >
        <div className="helix-axis" aria-hidden />
        {plates.map((p) => {
          // Endless: each plate's position along the spiral wraps round a 24-hour loop.
          const pos = ((((p.i - wind) % HOURS) + HOURS + HOURS / 2) % HOURS) - HOURS / 2;
          const angle = pos * STEP;
          const depth = Math.cos((angle * Math.PI) / 180);
          const level = p.jammed > 6 ? "high" : p.jammed > 0 || p.busy > 20 ? "moderate" : "low";
          const picked = p.hour === Math.floor(currentHour);
          return (
            <button
              key={p.i}
              type="button"
              className="helix-plate"
              data-level={level}
              data-picked={picked ? "" : undefined}
              onClick={() => onPick(p.ahead)}
              tabIndex={Math.abs(pos) < 4 ? 0 : -1}
              aria-label={`${String(p.hour).padStart(2, "0")}:00, ${p.jammed} jammed, ${p.busy} busy`}
              style={{
                transform: `translate(-50%,-50%) translateY(${pos * RISE}px) rotateY(${angle}deg) translateZ(118px)`,
                opacity:
                  Math.max(0, Math.min(1, 1.15 - Math.abs(pos) / 8)) *
                  (0.35 + 0.65 * Math.max(0, depth)),
                zIndex: Math.round(depth * 100),
              }}
            >
              <span className="helix-hour">{String(p.hour).padStart(2, "0")}</span>
              <span className="helix-bar" style={{ ["--load" as string]: Math.min(1, p.load) }} />
              <span className="helix-count">{p.jammed}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Worst hour ahead:{" "}
        <button
          type="button"
          className="font-mono text-foreground underline decoration-[var(--stark-red)] underline-offset-4"
          onClick={() => onPick(peak.ahead)}
        >
          {String(peak.hour).padStart(2, "0")}:00, {peak.jammed} jammed
        </button>
        . Plate number is junctions jammed, bar is average load. Forecast from the queue model.
      </p>
    </div>
  );
}
