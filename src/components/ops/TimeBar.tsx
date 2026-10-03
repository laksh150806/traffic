import { Clock, RotateCcw } from "lucide-react";
import { formatIstTime, istHourOf } from "@/lib/forecast";

export const MAX_OFFSET_MIN = 24 * 60;
const STEP_MIN = 5;

/** Minutes from `now` until the next time the Chennai clock reads `hour`. */
function minutesUntil(now: Date, hour: number) {
  const current = istHourOf(now) * 60;
  const target = hour * 60;
  const diff = target - current;
  return Math.round((diff <= 0 ? diff + 24 * 60 : diff) / STEP_MIN) * STEP_MIN;
}

function dayLabel(now: Date, at: Date) {
  const nowDay = Math.floor((now.getTime() + 5.5 * 3600_000) / 86_400_000);
  const atDay = Math.floor((at.getTime() + 5.5 * 3600_000) / 86_400_000);
  return atDay > nowDay ? "tomorrow" : "today";
}

export function TimeBar({
  now,
  offsetMin,
  onChange,
}: {
  now: Date;
  offsetMin: number;
  onChange: (minutes: number) => void;
}) {
  const at = new Date(now.getTime() + offsetMin * 60_000);
  const live = offsetMin === 0;
  const shortcuts = [
    { label: "Morning peak", minutes: minutesUntil(now, 9) },
    { label: "Evening peak", minutes: minutesUntil(now, 18.5) },
    { label: "Midnight", minutes: minutesUntil(now, 0) },
  ];

  return (
    <div className="panel pointer-events-auto flex w-full flex-col gap-2 px-4 py-3 @xl:flex-row @xl:items-center @xl:gap-4">
      <div className="flex min-w-[9.5rem] items-center gap-2">
        <Clock className="h-4 w-4 text-primary" aria-hidden />
        <div className="leading-tight">
          <p className="meta-label">{live ? "Live" : `Forecast, ${dayLabel(now, at)}`}</p>
          <p className="numeric text-sm text-foreground">{formatIstTime(at)}</p>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={MAX_OFFSET_MIN}
        step={STEP_MIN}
        value={offsetMin}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Time to look at, from now to 24 hours ahead"
        aria-valuetext={`${live ? "Now" : formatIstTime(at)}`}
        className="h-1.5 w-full min-w-0 flex-1 cursor-pointer accent-[var(--primary)]"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {shortcuts.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onChange(s.minutes)}
            className="glass-chip px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(0)}
          disabled={live}
          className="glass-button inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" /> Now
        </button>
      </div>
    </div>
  );
}
