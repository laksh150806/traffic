import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { fetchJunctionGains, type JunctionGain } from "@/lib/traffic-data";

export function useJunctionGains() {
  return useQuery({
    queryKey: ["junction-gains"],
    queryFn: fetchJunctionGains,
    refetchInterval: 6000,
  });
}

export const gainKind = (g: JunctionGain | undefined) =>
  !g ? "wait" : g.savedSec >= 0.5 ? "better" : g.savedSec <= -0.5 ? "worse" : "par";

/** One line on a junction card: what the adaptive controller is doing there right now. */
export function GainChip({ gain }: { gain: JunctionGain | undefined }) {
  const kind = gainKind(gain);
  const text =
    kind === "wait" || !gain
      ? "Adaptive: reading queues"
      : kind === "better"
        ? `Adaptive saves ${gain.savedSec.toFixed(1)}s per vehicle`
        : kind === "worse"
          ? `Fixed timer ${Math.abs(gain.savedSec).toFixed(1)}s better here`
          : gain.fixedSec > 25
            ? "Adaptive on par: too saturated for any timing"
            : "Adaptive on par: demand suits a fixed timer";
  return (
    <p className={`gain-chip is-${kind}`}>
      <i aria-hidden />
      {text}
    </p>
  );
}

/** Network-level summary of the adaptive controller, in plain words, with a way into each junction. */
export function AdaptiveBrief({
  gains,
  percent,
  selected,
}: {
  gains: JunctionGain[];
  percent: number;
  selected: { id: number; name: string } | null;
}) {
  const better = gains.filter((g) => gainKind(g) === "better");
  const worse = gains.filter((g) => gainKind(g) === "worse").length;
  const par = gains.length - better.length - worse;
  const top = [...better]
    .sort((a, b) => b.savedSec * b.flowVph - a.savedSec * a.flowVph)
    .slice(0, 3);
  const gainOfSelected = selected ? gains.find((g) => g.junction_id === selected.id) : undefined;

  return (
    <section className="brief" aria-label="Adaptive controller">
      <p className="rail-head">Adaptive controller</p>
      <p className="brief-big">
        {percent > 0 ? "−" : percent < 0 ? "+" : ""}
        {Math.abs(percent)}%<span> average wait vs a fixed timer</span>
      </p>
      <p className="brief-how">
        Every 12 s it reads each junction&apos;s queues and re-splits the green time, giving more to
        the approach that needs it. A fixed timer never changes.
      </p>
      <ul className="brief-tally">
        <li>
          <b>{better.length}</b> helping
        </li>
        <li>
          <b>{par}</b> on par
        </li>
        <li>
          <b>{worse}</b> fixed better
        </li>
      </ul>
      {top.length ? (
        <>
          <p className="ops-label mt-2">Biggest wins now</p>
          <ul className="brief-top">
            {top.map((g) => (
              <li key={g.junction_id}>
                <Link to="/junctions/$id" params={{ id: String(g.junction_id) }}>
                  <span>J-{String(g.junction_id).padStart(3, "0")}</span>
                  <b>−{g.savedSec.toFixed(1)}s</b>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="brief-how mt-2">
          Most junctions are saturated right now, so no timing can clear them. Adaptive shows its
          gain where demand has room.
        </p>
      )}
      <div className="brief-go">
        {selected ? (
          <Link to="/junctions/$id" params={{ id: String(selected.id) }} className="ops-btn solid">
            Open {selected.name}
            {gainOfSelected && gainKind(gainOfSelected) === "better"
              ? ` · −${gainOfSelected.savedSec.toFixed(1)}s`
              : ""}
          </Link>
        ) : (
          <p className="ops-label">Pick a junction on the map to open its controller.</p>
        )}
        <Link to="/junctions" className="ops-btn">
          All junctions
        </Link>
      </div>
    </section>
  );
}
