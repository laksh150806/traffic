import { formatIstTime, istDate } from "@/lib/forecast";

type Point = { hour: number; saturation: number; level: string };

/**
 * A day as a ring: midnight at the top, one spoke per hour, spoke length is how loaded the
 * junction is. The bright spoke is the hour on the map, the dashed hand is the time within it.
 * Clicking a spoke moves the map to that hour.
 */
const C = 110;
const R0 = 46;
const COLOUR: Record<string, string> = {
  LOW: "var(--signal-low)",
  MODERATE: "var(--signal-moderate)",
  HIGH: "var(--signal-high)",
};

const at = (r: number, hour: number): [number, number] => {
  const a = ((hour / 24) * 360 - 90) * (Math.PI / 180);
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};

export function DayDial({
  profile,
  hour,
  label,
  onPick,
}: {
  profile: Point[];
  /** Hour of day on the map, 0 to 24 with fractions. */
  hour: number;
  label: string;
  onPick?: ((hour: number) => void) | undefined;
}) {
  const current = Math.floor(hour) % 24;
  const [hx, hy] = at(R0 - 6, hour);
  const [hx2, hy2] = at(104, hour);
  const minutes = Math.round((hour % 1) * 60);
  return (
    <svg
      viewBox="0 0 220 220"
      className="mx-auto block w-full max-w-[250px]"
      role="img"
      aria-label={label}
    >
      <circle cx={C} cy={C} r={R0} fill="none" stroke="oklch(1 0 0 / 0.16)" />
      <circle
        cx={C}
        cy={C}
        r={R0 + 54}
        fill="none"
        stroke="oklch(1 0 0 / 0.06)"
        strokeDasharray="1 5"
      />
      {profile.map((p) => {
        const length = 6 + Math.min(1, p.saturation / 1.1) * 48;
        const mid = p.hour + 0.5;
        const [x1, y1] = at(R0 + 3, mid);
        const [x2, y2] = at(R0 + 3 + length, mid);
        const [x3, y3] = at(R0 + 62, mid);
        const here = p.hour === current;
        return (
          <g key={p.hour}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={COLOUR[p.level] ?? "var(--primary)"}
              strokeWidth={here ? 6 : 4.2}
              strokeLinecap="round"
              opacity={here ? 1 : 0.55}
              style={{ transition: "opacity 300ms" }}
            />
            {onPick ? (
              <line
                x1={x1}
                y1={y1}
                x2={x3}
                y2={y3}
                stroke="transparent"
                strokeWidth="12"
                style={{ cursor: "pointer" }}
                onClick={() => onPick(p.hour)}
              >
                <title>{formatIstTime(istDate(p.hour))}</title>
              </line>
            ) : null}
          </g>
        );
      })}
      {[0, 6, 12, 18].map((h) => {
        const [x, y] = at(R0 - 14, h);
        return (
          <text
            key={h}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-muted-foreground"
            style={{ fontSize: 8, fontFamily: "var(--font-mono)" }}
          >
            {h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`}
          </text>
        );
      })}
      <line
        x1={hx}
        y1={hy}
        x2={hx2}
        y2={hy2}
        stroke="var(--stark-red)"
        strokeWidth="1.4"
        strokeDasharray="3 2"
      />
      <circle cx={hx2} cy={hy2} r="2.6" fill="var(--stark-red)" />
      <text
        x={C}
        y={C}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground"
        style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}
      >
        {formatIstTime(istDate(current, minutes))}
      </text>
    </svg>
  );
}
