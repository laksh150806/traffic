import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MapPin, Search, X } from "lucide-react";
import type { JunctionSummary } from "@/lib/traffic-types";

const DOT: Record<string, string> = {
  LOW: "bg-signal-low",
  MODERATE: "bg-signal-moderate",
  HIGH: "bg-signal-high",
};

type Props = {
  junctions: JunctionSummary[];
  placeholder: string;
  label: string;
  /** Text shown while nothing is being typed, e.g. the chosen place. */
  value?: string | null;
  onPick: (junction: JunctionSummary) => void;
  onClear?: () => void;
  icon?: "search" | "pin";
  tint?: string;
};

/** Match on the start of any word first, then anywhere in the name or zone. */
export function searchJunctions(junctions: JunctionSummary[], query: string, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ j: JunctionSummary; score: number }> = [];
  for (const j of junctions) {
    const name = j.name.toLowerCase();
    const zone = j.zone.toLowerCase();
    let score = 0;
    if (name.startsWith(q)) score = 4;
    else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 3;
    else if (name.includes(q)) score = 2;
    else if (zone.includes(q)) score = 1;
    if (score > 0) scored.push({ j, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.j.name.localeCompare(b.j.name))
    .slice(0, limit)
    .map((s) => s.j);
}

export function SearchBox({
  junctions,
  placeholder,
  label,
  value,
  onPick,
  onClear,
  icon = "search",
  tint,
}: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchJunctions(junctions, query), [junctions, query]);
  const Icon = icon === "pin" ? MapPin : Search;

  const choose = (junction: JunctionSummary) => {
    onPick(junction);
    setQuery("");
    setOpen(false);
    input.current?.blur();
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      const hit = results[active];
      if (hit) {
        event.preventDefault();
        choose(hit);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="relative">
      <div className="glass-chip flex items-center gap-2 !rounded-xl px-3">
        <Icon className="h-4 w-4 shrink-0" style={tint ? { color: tint } : undefined} aria-hidden />
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          value={open || !value ? query : value}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {(value || query) && onClear ? (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              setQuery("");
              onClear();
            }}
            className="rounded-full p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && query.trim() ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="panel absolute inset-x-0 top-full z-[900] mt-1.5 max-h-72 overflow-y-auto !rounded-xl p-1"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">
              No junction matches "{query}".
            </li>
          ) : (
            results.map((junction, index) => (
              <li key={junction.junction_id} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(junction)}
                  onMouseEnter={() => setActive(index)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                    index === active ? "bg-white/10" : ""
                  }`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${DOT[junction.congestion_level]}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{junction.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {junction.zone} zone
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
