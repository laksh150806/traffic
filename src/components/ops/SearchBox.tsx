import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MapPin, Search, X } from "lucide-react";
import { searchJunctions } from "@/lib/search";
import type { JunctionSummary } from "@/lib/traffic-types";

const DOT: Record<string, string> = {
  LOW: "bg-signal-low",
  MODERATE: "bg-signal-moderate",
  HIGH: "bg-signal-high",
};

const LEVEL_WORD: Record<string, string> = {
  LOW: "free flowing",
  MODERATE: "busy",
  HIGH: "jammed",
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
  const closeTimer = useRef<number | undefined>(undefined);
  const results = useMemo(() => searchJunctions(junctions, query), [junctions, query]);
  const Icon = icon === "pin" ? MapPin : Search;
  const listOpen = open && results.length > 0;
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const choose = (junction: JunctionSummary) => {
    onPick(junction);
    setQuery("");
    setOpen(false);
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
          role="combobox"
          aria-label={label}
          aria-expanded={listOpen}
          aria-controls={listOpen ? `${id}-list` : undefined}
          aria-activedescendant={listOpen ? optionId(active) : undefined}
          aria-autocomplete="list"
          value={open || !value ? query : value}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            window.clearTimeout(closeTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            window.clearTimeout(closeTimer.current);
            closeTimer.current = window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKey}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {(value || query) && onClear ? (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              setQuery("");
              onClear();
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* Announce the outcome of a search to people who cannot see the list. */}
      <p role="status" className="sr-only">
        {open && query.trim()
          ? results.length === 0
            ? `No junction matches ${query}`
            : `${results.length} ${results.length === 1 ? "junction" : "junctions"} found`
          : ""}
      </p>

      {open && query.trim() && results.length === 0 ? (
        <p className="panel absolute inset-x-0 top-full z-[900] mt-1.5 !rounded-xl px-3 py-2.5 text-xs text-muted-foreground">
          No junction matches &quot;{query}&quot;.
        </p>
      ) : null}

      {listOpen ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} results`}
          className="panel absolute inset-x-0 top-full z-[900] mt-1.5 max-h-72 overflow-y-auto !rounded-xl p-1"
        >
          {results.map((junction, index) => (
            <li
              key={junction.junction_id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              // Keep focus in the input so the arrow keys keep working while the pointer picks.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(junction)}
              onMouseEnter={() => setActive(index)}
              className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                index === active ? "bg-white/10" : ""
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${DOT[junction.congestion_level]}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{junction.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {junction.zone} zone, {LEVEL_WORD[junction.congestion_level]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
