import type { RoadState } from "@/lib/traffic-types";
import type { JunctionForecast } from "@/lib/forecast";
import { junctionAspects, type Aspect } from "@/lib/signal-aspect";
import { useSecondClock } from "@/components/space/useFontsReady";

/**
 * The selected junction as a compass of four bands, one per approach.
 *
 * - Band thickness is the queue on that approach. A faint dashed ghost behind it is the queue the
 *   fixed timer would leave, so the gap between them is what adaptive timing saves.
 * - Band colour is what the signal head shows now (green, amber or red).
 * - The thin outer arc runs down the seconds left on the green.
 * - The centre says how long the green has left, or that the junction is changing over.
 *
 * For a forecast hour there is no live signal, so bands show only the queues the model expects.
 */
const CENTRE = 110;
const MID_R = 62;
const SPAN = 66;
// North, south, east, west: the order the forecast arrays use. Degrees run clockwise from north.
const SIDES = [
  { key: "N", name: "North", deg: 0 },
  { key: "S", name: "South", deg: 180 },
  { key: "E", name: "East", deg: 90 },
  { key: "W", name: "West", deg: 270 },
] as const;

const point = (r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CENTRE + r * Math.cos(a), CENTRE + r * Math.sin(a)];
};
const arc = (r: number, from: number, to: number) => {
  const [x1, y1] = point(r, from);
  const [x2, y2] = point(r, to);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

const THICK_MAX = 30;
const QUEUE_FULL = 28;
const thickness = (queue: number) => 6 + Math.min(1, queue / QUEUE_FULL) * THICK_MAX;

const ASPECT_COLOUR: Record<Aspect, string> = {
  GREEN: "var(--signal-low)",
  AMBER: "var(--signal-moderate)",
  RED: "var(--signal-high)",
};
const EASE = "700ms cubic-bezier(.22,1,.36,1)";

export function SignalCompass({
  roads,
  forecast,
  live,
}: {
  roads: RoadState[];
  forecast: JunctionForecast;
  /** True when the signal shown is the present one; false for a forecast hour. */
  live: boolean;
}) {
  const now = useSecondClock();
  const rows = roads.map((r) => ({
    id: r.road_id,
    isGreen: r.is_currently_green,
    startedAtMs: r.phase_started_at ? Date.parse(r.phase_started_at) : 0,
  }));
  const aspects = live ? junctionAspects(rows, now) : new Map<number, Aspect>();
  const green = live ? roads.find((r) => r.is_currently_green) : undefined;
  const started = green?.phase_started_at ? Date.parse(green.phase_started_at) : now;
  const left = green ? Math.max(0, green.green_duration_sec - (now - started) / 1000) : 0;
  const total = green ? Math.max(1, green.green_duration_sec) : 1;
  const clearing = green ? aspects.get(green.road_id) === "RED" : false;
  const counting = Boolean(green) && !clearing;

  const aspectOf = (key: string): Aspect | undefined => {
    const road = roads.find((r) => r.direction.toUpperCase().startsWith(key));
    return road ? aspects.get(road.road_id) : undefined;
  };

  const label = !live
    ? "forecast"
    : clearing
      ? "changing over"
      : green
        ? `${green.direction.charAt(0).toUpperCase()}${green.direction.slice(1).toLowerCase()} green`
        : "no signal";
  const aria = SIDES.map(
    (side, i) => `${side.name} ${Math.round(forecast.approachQueues[i] ?? 0)} queued`,
  ).join(", ");

  return (
    <figure className="mx-auto mt-3 w-full max-w-[300px]">
      <svg
        viewBox="0 0 220 220"
        className="block w-full"
        role="img"
        aria-label={`Signal compass: ${aria}`}
      >
        <circle cx={CENTRE} cy={CENTRE} r="100" fill="none" stroke="oklch(1 0 0 / 0.1)" />
        <g className="compass-orbit">
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r="108"
            fill="none"
            stroke="oklch(1 0 0 / 0.22)"
            strokeDasharray="1 7"
          />
          <path d={arc(108, -20, 20)} fill="none" stroke="var(--stark-red)" strokeWidth="1.2" />
        </g>
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r="36"
          fill="none"
          stroke="oklch(1 0 0 / 0.14)"
          strokeDasharray="2 4"
        />
        {Array.from({ length: 36 }, (_, i) => {
          const [x1, y1] = point(100, i * 10);
          const [x2, y2] = point(i % 9 === 0 ? 92 : 96, i * 10);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="oklch(1 0 0 / 0.28)"
              strokeWidth={i % 9 === 0 ? 1.4 : 0.8}
            />
          );
        })}
        {SIDES.map((side, i) => {
          const queue = forecast.approachQueues[i] ?? 0;
          const adaptive = forecast.approachDelayAdaptive[i] ?? 0;
          const fixed = forecast.approachDelayFixed[i] ?? 0;
          const ratio = adaptive > 0 ? Math.max(1, fixed / adaptive) : 1;
          const ghost = Math.min(THICK_MAX + 6, thickness(queue * ratio));
          const aspect = aspectOf(side.key);
          const colour = aspect ? ASPECT_COLOUR[aspect] : "oklch(0.95 0.004 260)";
          const from = side.deg - SPAN / 2;
          const to = side.deg + SPAN / 2;
          const active = aspect === "GREEN";
          const [lx, ly] = point(88, side.deg);
          return (
            <g key={side.key}>
              <path
                d={arc(MID_R, from, to)}
                fill="none"
                stroke="oklch(1 0 0)"
                strokeOpacity="0.14"
                strokeWidth={ghost}
                strokeDasharray="3 2"
                style={{ transition: `stroke-width ${EASE}` }}
              />
              <path
                d={arc(MID_R, from, to)}
                fill="none"
                stroke={colour}
                strokeOpacity={aspect === "RED" ? 0.55 : 0.95}
                strokeWidth={thickness(queue)}
                style={{
                  transition: `stroke-width ${EASE}, stroke 300ms, stroke-opacity 300ms`,
                  filter: active ? "drop-shadow(0 0 6px var(--signal-low))" : undefined,
                }}
              />
              {active && green ? (
                <path
                  d={arc(106, from, to)}
                  pathLength={100}
                  fill="none"
                  stroke="var(--signal-low)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeDasharray={`${(left / total) * 100} 100`}
                  style={{ transition: "stroke-dasharray 1s linear" }}
                />
              ) : null}
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-muted-foreground"
                style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}
              >
                {Math.round(queue)}
              </text>
            </g>
          );
        })}
        <text
          x={CENTRE}
          y={CENTRE - 4}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground"
          style={{ fontSize: counting ? 24 : 15, fontFamily: "var(--font-mono)" }}
        >
          {counting ? Math.ceil(left) : live ? "..." : `${Math.round(forecast.saturation * 100)}%`}
        </text>
        <text
          x={CENTRE}
          y={CENTRE + 17}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 8.5, fontFamily: "var(--font-display)", letterSpacing: "0.08em" }}
        >
          {label.toUpperCase()}
        </text>
      </svg>
      <figcaption className="mt-1 text-center text-[11px] text-muted-foreground">
        Band width is the queue. The dashed ghost is what the fixed timer would leave.
      </figcaption>
    </figure>
  );
}
