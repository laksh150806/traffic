import type { KeyboardEvent, ReactNode } from "react";

export type Branch<T extends string> = {
  id: T;
  label: string;
  /** A live figure beside the branch (jam count, route time), so the menu is also a readout. */
  reading?: ReactNode | undefined;
  hot?: boolean | undefined;
};

/**
 * The mode menu as a trunk with branches. A lit line runs down the trunk and out along the branch
 * that is open, so where you are is drawn, not just highlighted.
 */
export function BranchedMenu<T extends string>({
  branches,
  value,
  onChange,
  label,
}: {
  branches: Branch<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const index = Math.max(
    0,
    branches.findIndex((b) => b.id === value),
  );
  const ROW = 34;
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = branches[(index + step + branches.length) % branches.length];
    if (!next) return;
    onChange(next.id);
    document.getElementById(`branch-${next.id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="vertical"
      onKeyDown={onKey}
      className="branch-menu relative"
      style={{ height: branches.length * ROW + 8 }}
    >
      <svg
        className="pointer-events-none absolute left-0 top-0 h-full w-7"
        viewBox={`0 0 28 ${branches.length * ROW + 8}`}
        aria-hidden
      >
        {/* the trunk */}
        <line x1="8" y1="4" x2="8" y2={branches.length * ROW} className="branch-trunk" />
        {branches.map((b, i) => (
          <path
            key={b.id}
            d={`M8 ${i * ROW + ROW / 2 - 6} q0 8 8 8 h10`}
            className={i === index ? "branch-twig branch-twig-on" : "branch-twig"}
          />
        ))}
        {/* the lit trace: down the trunk to the open branch, then out */}
        <path
          key={value}
          d={`M8 4 V${index * ROW + ROW / 2 - 6} q0 8 8 8 h10`}
          className="branch-trace"
          pathLength={100}
        />
      </svg>
      {branches.map((b, i) => (
        <button
          key={b.id}
          id={`branch-${b.id}`}
          type="button"
          role="tab"
          aria-selected={b.id === value}
          aria-controls={`panel-${b.id}`}
          tabIndex={b.id === value ? 0 : -1}
          onClick={() => onChange(b.id)}
          className="branch-item absolute left-7 right-0 flex items-center justify-between gap-2 pl-1.5 pr-2 text-left"
          style={{ top: i * ROW + 2, height: ROW - 4 }}
          data-hot={b.hot ? "" : undefined}
        >
          <span className="branch-label">{b.label}</span>
          {b.reading !== undefined ? <span className="branch-reading">{b.reading}</span> : null}
        </button>
      ))}
    </div>
  );
}
