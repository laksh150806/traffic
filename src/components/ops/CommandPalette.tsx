import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, MapPin, Search, Zap } from "lucide-react";
import { searchJunctions } from "@/lib/search";
import type { JunctionSummary } from "@/lib/traffic-types";

export type PaletteAction = {
  id: string;
  label: string;
  /** Extra words that should find this action. */
  keywords?: string;
  hint?: string;
  run: () => void;
};

type Item =
  | { kind: "junction"; key: string; junction: JunctionSummary }
  | { kind: "action"; key: string; action: PaletteAction };

const DOT: Record<string, string> = {
  LOW: "bg-signal-low",
  MODERATE: "bg-signal-moderate",
  HIGH: "bg-signal-high",
};

/**
 * Ctrl or Cmd plus K (or "/" outside a text field) opens a box that finds a junction or runs an
 * action: play the demo, jump to a peak, change the scenario, copy a link. Everything it does is
 * also reachable from the page; this is the fast way for someone at a keyboard.
 */
export function CommandPalette({
  junctions,
  actions,
  onPickJunction,
}: {
  junctions: JunctionSummary[];
  actions: PaletteAction[];
  onPickJunction: (junction: JunctionSummary) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery("");
      setActive(0);
      // After the portal has mounted.
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      returnFocus.current?.focus?.();
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const matchedActions = actions.filter(
      (a) => !q || `${a.label} ${a.keywords ?? ""}`.toLowerCase().includes(q),
    );
    const places = q ? searchJunctions(junctions, q, 6) : [];
    return [
      ...places.map<Item>((junction) => ({
        kind: "junction",
        key: `j${junction.junction_id}`,
        junction,
      })),
      ...matchedActions.map<Item>((action) => ({ kind: "action", key: action.id, action })),
    ];
  }, [actions, junctions, query]);

  useEffect(() => setActive(0), [query]);

  if (!open || typeof document === "undefined") return null;

  const choose = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    if (item.kind === "junction") onPickJunction(item.junction);
    else item.action.run();
  };

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") {
      // The box is the only thing on offer while it is open.
      event.preventDefault();
    }
  };

  const optionId = (index: number) => `${id}-option-${index}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/50 px-4 pt-[14vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search junctions and run commands"
        className="panel w-full max-w-[560px] overflow-hidden"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={items.length ? optionId(active) : undefined}
            aria-label="Type a junction name or a command"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKey}
            placeholder="Find a junction or run a command"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="glass-chip px-2 py-0.5 text-[11px] text-muted-foreground">Esc</kbd>
        </div>
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Results"
          className="scroll-glass max-h-[44vh] overflow-y-auto p-2"
        >
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nothing matches &ldquo;{query}&rdquo;.
            </li>
          ) : (
            items.map((item, index) => (
              <li
                key={item.key}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onMouseMove={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(item);
                }}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                  index === active ? "bg-primary/15 text-foreground" : "text-muted-foreground"
                }`}
              >
                {item.kind === "junction" ? (
                  <>
                    <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-foreground">{item.junction.name}</span>{" "}
                      <span className="text-xs">{item.junction.zone}</span>
                    </span>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${DOT[item.junction.congestion_level] ?? "bg-muted"}`}
                      aria-hidden
                    />
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {item.action.label}
                    </span>
                    {item.action.hint ? (
                      <span className="text-xs text-muted-foreground">{item.action.hint}</span>
                    ) : null}
                  </>
                )}
                {index === active ? (
                  <CornerDownLeft
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
