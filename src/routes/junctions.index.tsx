import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { HoloCard, Spotlight } from "@/components/fx/controls";
import { HexField, Decrypt, RollNumber } from "@/components/fx/text";
import {
  HexStream,
  HudFrame,
  HudRing,
  Lattice,
  NodeRack,
  Radar,
  Serial,
  Spectrum,
  type Blip,
} from "@/components/fx/decor";
import { GainChip, useJunctionGains } from "@/components/ops/AdaptiveBrief";
import { fetchJunctions, type JunctionSummary } from "@/lib/traffic-data";

export const Route = createFileRoute("/junctions/")({
  head: () => ({ meta: [{ title: "Junctions · SIGNAL OPS" }] }),
  component: JunctionsPage,
});

type Level = JunctionSummary["congestion_level"];
const LEVELS: Array<Level | "ALL"> = ["ALL", "HIGH", "MODERATE", "LOW"];
const LEVEL_WORD: Record<Level, string> = { HIGH: "Jammed", MODERATE: "Busy", LOW: "Flowing" };

function blipsOf(junctions: JunctionSummary[]): Blip[] {
  if (junctions.length === 0) return [];
  const lat0 = junctions.reduce((s, j) => s + j.latitude, 0) / junctions.length;
  const lng0 = junctions.reduce((s, j) => s + j.longitude, 0) / junctions.length;
  const far = Math.max(
    ...junctions.map((j) => Math.hypot(j.latitude - lat0, j.longitude - lng0)),
    1e-6,
  );
  return junctions.map((j) => ({
    id: j.junction_id,
    bearing: Math.atan2(j.longitude - lng0, j.latitude - lat0),
    dist: Math.hypot(j.latitude - lat0, j.longitude - lng0) / far,
    level: j.congestion_level,
    label: j.name,
  }));
}

function JunctionsPage() {
  const q = useQuery({ queryKey: ["junctions"], queryFn: fetchJunctions, refetchInterval: 6000 });
  const gainsQ = useJunctionGains();
  const gains = useMemo(
    () => new Map((gainsQ.data ?? []).map((g) => [g.junction_id, g])),
    [gainsQ.data],
  );
  const [sortBy, setSortBy] = useState<"load" | "gain">("load");
  const [level, setLevel] = useState<Level | "ALL">("ALL");
  const [zone, setZone] = useState("ALL");
  const [text, setText] = useState("");
  const all = useMemo(() => q.data ?? [], [q.data]);
  const zones = useMemo(() => ["ALL", ...new Set(all.map((j) => j.zone))].sort(), [all]);
  const shown = useMemo(
    () =>
      all
        .filter(
          (j) =>
            (level === "ALL" || j.congestion_level === level) &&
            (zone === "ALL" || j.zone === zone),
        )
        .filter((j) => j.name.toLowerCase().includes(text.trim().toLowerCase()))
        .sort((a, b) =>
          sortBy === "gain"
            ? (gains.get(b.junction_id)?.savedSec ?? 0) - (gains.get(a.junction_id)?.savedSec ?? 0)
            : b.avg_vehicle_count - a.avg_vehicle_count,
        ),
    [all, level, zone, text, sortBy, gains],
  );
  const counts = { HIGH: 0, MODERATE: 0, LOW: 0 } as Record<Level, number>;
  for (const j of all) counts[j.congestion_level]++;
  const maxAvg = Math.max(1, ...all.map((j) => j.avg_vehicle_count));
  const blips = useMemo(() => blipsOf(all), [all]);

  return (
    <div className="ops-page">
      <header className="ops-head">
        <div>
          <p className="ops-kicker">Sector index · {all.length} nodes</p>
          <Decrypt as="h1" className="ops-h1" text="Junction register" />
          <p className="ops-sub mt-2">
            Each card shows what the adaptive controller is doing there: how much waiting it saves
            against a fixed timer. Open one for its live camera, the green plan, and one-tap manual
            control.
          </p>
        </div>
        <HexField rows={5} cols={30} className="hidden md:block" />
      </header>

      <div className="ops-grid lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="ops-filters flex flex-wrap items-end gap-3">
            <div role="radiogroup" aria-label="Filter by congestion" className="ops-seg">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={level === l}
                  className={level === l ? "is-on" : ""}
                  onClick={() => setLevel(l)}
                >
                  {l === "ALL" ? `All ${all.length}` : `${LEVEL_WORD[l]} ${counts[l]}`}
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-label="Sort junctions" className="ops-seg">
              <button
                type="button"
                role="radio"
                aria-checked={sortBy === "load"}
                className={sortBy === "load" ? "is-on" : ""}
                onClick={() => setSortBy("load")}
              >
                Busiest
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={sortBy === "gain"}
                className={sortBy === "gain" ? "is-on" : ""}
                onClick={() => setSortBy("gain")}
              >
                Adaptive wins
              </button>
            </div>
            <label className="ops-field w-44">
              <span className="ops-label">Zone</span>
              <select
                className="ops-select mt-1"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z === "ALL" ? "All zones" : z}
                  </option>
                ))}
              </select>
            </label>
            <label className="ops-field flex-1 min-w-48">
              <span className="ops-label">Search</span>
              <input
                className="ops-select mt-1"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="junction name"
              />
            </label>
          </div>

          {q.isLoading ? (
            <div className="grid h-64 place-items-center">
              <Lattice label="Loading junctions" />
            </div>
          ) : q.isError ? (
            <p role="alert" className="ops-panel ops-red">
              Could not read junctions:{" "}
              {q.error instanceof Error ? q.error.message : "unknown error"}
            </p>
          ) : shown.length === 0 ? (
            <p className="ops-panel ops-dim">No junction matches these filters.</p>
          ) : (
            <ul className="fx-focus grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((j, i) => (
                <li
                  key={j.junction_id}
                  className="ops-card-in"
                  style={{ animationDelay: `${Math.min(i, 18) * 35}ms` }}
                >
                  <HoloCard hot={j.congestion_level === "HIGH"} className="h-full">
                    <Link
                      to="/junctions/$id"
                      params={{ id: String(j.junction_id) }}
                      className="ops-jcard"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="ops-label">
                          J-{String(j.junction_id).padStart(3, "0")} · {j.zone}
                        </span>
                        <span className={`ops-lvl lvl-${j.congestion_level}`}>
                          {LEVEL_WORD[j.congestion_level]}
                        </span>
                      </div>
                      <h2 className="ops-jname">{j.name}</h2>
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <span className="ops-label block">Avg / approach</span>
                          <RollNumber
                            value={Math.round(j.avg_vehicle_count)}
                            className="ops-value"
                          />
                        </div>
                        <Spectrum level={j.avg_vehicle_count / maxAvg} bars={16} className="w-28" />
                      </div>
                      <div className="ops-loadbar" aria-hidden>
                        <i
                          className={`bg-lvl-${j.congestion_level}`}
                          style={{ width: `${(j.avg_vehicle_count / maxAvg) * 100}%` }}
                        />
                      </div>
                      <GainChip gain={gains.get(j.junction_id)} />
                      <Serial code={`${j.latitude.toFixed(3)}N ${j.longitude.toFixed(3)}E`} />
                    </Link>
                  </HoloCard>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-[70px] lg:self-start">
          <HudFrame label="Network radar" code="BRG/DST">
            <div className="relative aspect-square">
              <Radar blips={blips} label="Junctions by bearing from the city centre" />
            </div>
            <p className="ops-label mt-2">
              Bearing and distance from the network centre. Red pings are jammed.
            </p>
          </HudFrame>
          <HudFrame label="Node rack" code={`${all.length} CELLS`}>
            <div className="h-28">
              <NodeRack cells={all.map((j) => j.congestion_level)} />
            </div>
          </HudFrame>
          <div className="grid grid-cols-[auto_1fr] items-center gap-3">
            <HudRing size={118}>
              <Spotlight>
                <span className="ops-label block">Jammed</span>
                <RollNumber value={counts.HIGH} className="ops-value ops-red" />
              </Spotlight>
            </HudRing>
            <div className="ops-panel h-[118px] overflow-hidden p-2">
              <HexStream lines={10} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
