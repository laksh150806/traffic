import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { HoldButton, ScrubField } from "@/components/fx/controls";
import { toast } from "@/components/fx/global";
import { canOperate, useAuth } from "@/lib/auth";
import { DATA_MODE } from "@/lib/data-mode";
import { INCIDENT_KINDS, reportIncident, type IncidentKind } from "@/lib/ops-data";
import { reportRoadIncident } from "@/lib/sim-engine";
import { fetchJunctions, fetchRoadStates } from "@/lib/traffic-data";

const isSimulated = DATA_MODE === "simulated";
const KIND_WORD: Record<IncidentKind, string> = {
  ACCIDENT: "Accident",
  LANE_BLOCKED: "Lane blocked",
  ROADWORK: "Roadwork",
  SIGNAL_FAULT: "Signal fault",
};

/** Report a blocked approach. Live: written to the incidents table under RLS. Simulated: in memory. */
export function IncidentForm({ junctionId: fixedJunction }: { junctionId?: number }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const allowed = isSimulated || canOperate(auth);
  const junctions = useQuery({
    queryKey: ["junctions"],
    queryFn: fetchJunctions,
    refetchInterval: 6000,
  });
  const [junctionId, setJunctionId] = useState<number | null>(fixedJunction ?? null);
  const roads = useQuery({
    queryKey: ["roads", junctionId],
    queryFn: () => fetchRoadStates(junctionId as number),
    enabled: junctionId !== null,
  });
  const [roadId, setRoadId] = useState<number | null>(null);
  const [kind, setKind] = useState<IncidentKind>("ACCIDENT");
  const [severity, setSeverity] = useState<1 | 2 | 3>(2);
  const [minutes, setMinutes] = useState(30);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (junctionId === null && junctions.data?.[0]) setJunctionId(junctions.data[0].junction_id);
  }, [junctionId, junctions.data]);
  useEffect(() => {
    const first = roads.data?.[0];
    if (first && !roads.data?.some((r) => r.road_id === roadId)) setRoadId(first.road_id);
  }, [roads.data, roadId]);

  const submit = async () => {
    if (junctionId === null || roadId === null || sending) return;
    setSending(true);
    try {
      if (isSimulated) {
        reportRoadIncident(roadId, kind === "ROADWORK" ? "works" : "accident", minutes * 60);
      } else {
        await reportIncident({ junctionId, roadId, kind, severity, minutes, note });
      }
      setNote("");
      toast(`${KIND_WORD[kind]} logged. Capacity cut on that approach.`, "ok");
      void queryClient.invalidateQueries();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not report the incident", "bad");
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => e.preventDefault()}
      aria-label="Report an incident"
    >
      {fixedJunction === undefined ? (
        <label className="ops-field block">
          <span className="ops-label">Junction</span>
          <select
            className="ops-select mt-1"
            value={junctionId ?? ""}
            onChange={(e) => {
              setJunctionId(Number(e.target.value));
              setRoadId(null);
            }}
          >
            {(junctions.data ?? []).map((j) => (
              <option key={j.junction_id} value={j.junction_id}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <label className="ops-field block">
          <span className="ops-label">Approach</span>
          <select
            className="ops-select mt-1"
            value={roadId ?? ""}
            onChange={(e) => setRoadId(Number(e.target.value))}
          >
            {(roads.data ?? []).map((r) => (
              <option key={r.road_id} value={r.road_id}>
                {r.direction}
                {r.road_name ? ` · ${r.road_name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="ops-field block">
          <span className="ops-label">Kind</span>
          <select
            className="ops-select mt-1"
            value={kind}
            onChange={(e) => setKind(e.target.value as IncidentKind)}
          >
            {INCIDENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_WORD[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div role="radiogroup" aria-label="Severity" className="ops-seg w-full">
        {([1, 2, 3] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={severity === s}
            className={`flex-1 ${severity === s ? "is-on" : ""} ${s === 3 ? "sev-3" : ""}`}
            onClick={() => setSeverity(s)}
          >
            {s === 1 ? "Minor" : s === 2 ? "Major" : "Critical"}
          </button>
        ))}
      </div>
      <ScrubField
        label="Expected duration"
        value={minutes}
        onChange={setMinutes}
        min={5}
        max={240}
        step={5}
        unit="min"
      />
      {isSimulated ? null : (
        <label className="ops-field block">
          <span className="ops-label">Note</span>
          <textarea
            className="mt-1"
            rows={2}
            maxLength={280}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What the field unit reported"
          />
        </label>
      )}
      <HoldButton
        tone="red"
        disabled={!allowed || sending || roadId === null}
        onHold={() => void submit()}
        ms={900}
      >
        {sending ? "Logging" : "Hold to log incident"}
      </HoldButton>
      {!allowed ? <p className="ops-label">Sign in as an operator to report incidents.</p> : null}
    </form>
  );
}
