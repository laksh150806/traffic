import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { ElectricBorder, HoldButton, ScrubField } from "@/components/fx/controls";
import { CameraFeed } from "@/components/fx/CameraFeed";
import { toast } from "@/components/fx/global";
import { Decrypt, GlitchText, RollNumber, TypeLine } from "@/components/fx/text";
import {
  HudFrame,
  HudRing,
  Lattice,
  MagnetLines,
  Scope,
  Serial,
  Spectrum,
  StatusMark,
} from "@/components/fx/decor";
import { IncidentForm } from "@/components/shell/IncidentForm";
import { canOperate, useAuth, useNow } from "@/lib/auth";
import { DATA_MODE } from "@/lib/data-mode";
import { fetchActiveHolds, holdSignal, releaseHold } from "@/lib/ops-data";
import { clearOperatorOverride, setOperatorOverride } from "@/lib/sim-engine";
import {
  fetchCycleComparison,
  fetchJunctionModel,
  fetchJunctions,
  fetchRoadStates,
} from "@/lib/traffic-data";
import type { RoadState } from "@/lib/traffic-types";

const CycleChart = lazy(() =>
  import("@/components/traffic/CycleChart").then((m) => ({ default: m.CycleChart })),
);

export const Route = createFileRoute("/junctions/$id")({
  head: () => ({ meta: [{ title: "Junction · SIGNAL OPS" }] }),
  component: JunctionPage,
});

const isSimulated = DATA_MODE === "simulated";

/** Each approach gets an arc as long as its share of the cycle; the green one glows and counts down. */
function PhaseRing({ roads, now }: { roads: RoadState[]; now: number }) {
  const total = roads.reduce((s, r) => s + Math.max(1, r.green_duration_sec), 0) || 1;
  const R = 78;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const green = roads.find((r) => r.is_currently_green);
  const left = green?.phase_started_at
    ? Math.max(
        0,
        Math.round(green.green_duration_sec - (now - Date.parse(green.phase_started_at)) / 1000),
      )
    : null;
  return (
    <HudRing size={240}>
      <svg viewBox="0 0 200 200" className="ops-phasering" aria-hidden>
        {roads.map((r) => {
          const len = (Math.max(1, r.green_duration_sec) / total) * C;
          const el = (
            <circle
              key={r.road_id}
              cx="100"
              cy="100"
              r={R}
              className={r.is_currently_green ? "seg is-green" : "seg"}
              strokeDasharray={`${Math.max(0, len - 3)} ${C}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="relative">
        <span className="ops-label block">{green ? `${green.direction} green` : "All red"}</span>
        <span className="ops-value ops-green">
          {left === null ? "--" : <RollNumber value={left} pad={2} />}
        </span>
        <span className="ops-label block">s left</span>
      </div>
    </HudRing>
  );
}

function JunctionPage() {
  const { id } = Route.useParams();
  const junctionId = Number(id);
  const auth = useAuth();
  const queryClient = useQueryClient();
  const now = useNow(1000);
  const allowed = isSimulated || canOperate(auth);

  const junctions = useQuery({
    queryKey: ["junctions"],
    queryFn: fetchJunctions,
    refetchInterval: 6000,
  });
  const roads = useQuery({
    queryKey: ["roads", junctionId],
    queryFn: () => fetchRoadStates(junctionId),
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
  });
  const model = useQuery({
    queryKey: ["model", junctionId],
    queryFn: () => fetchJunctionModel(junctionId),
    refetchInterval: 6000,
  });
  const cycles = useQuery({
    queryKey: ["cycles", junctionId],
    queryFn: () => fetchCycleComparison(junctionId),
    refetchInterval: 6000,
  });
  const holds = useQuery({
    queryKey: ["holds"],
    queryFn: fetchActiveHolds,
    enabled: !isSimulated && auth.status === "signed-in",
    refetchInterval: 5000,
    retry: false,
  });

  const junction = junctions.data?.find((j) => j.junction_id === junctionId);
  const roadList = roads.data ?? [];
  const hold = holds.data?.find((h) => h.junction_id === junctionId && Date.parse(h.ends_at) > now);
  const [holdRoad, setHoldRoad] = useState<number | null>(null);
  const [holdMin, setHoldMin] = useState(3);
  const [reason, setReason] = useState("Clear queue for emergency vehicle");
  const target = holdRoad ?? roadList[0]?.road_id ?? null;
  const maxQueue = Math.max(1, ...(model.data ?? []).map((m) => m.queue_now));
  const avgDos = useMemo(() => {
    const m = model.data ?? [];
    return m.length ? m.reduce((s, r) => s + r.degree_saturation, 0) / m.length : 0;
  }, [model.data]);
  const userId = auth.status === "signed-in" ? auth.operator.userId : null;

  const doHold = async () => {
    if (target === null) return;
    try {
      if (isSimulated) setOperatorOverride(junctionId, target, holdMin * 60);
      else {
        if (!userId) throw new Error("Sign in as an operator first");
        await holdSignal({ junctionId, roadId: target, minutes: holdMin, reason, userId });
      }
      toast(
        `Green held on ${roadList.find((r) => r.road_id === target)?.direction ?? "approach"} for ${holdMin} min.`,
        "ok",
      );
      void queryClient.invalidateQueries();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Hold refused", "bad");
    }
  };
  const doRelease = async () => {
    try {
      if (isSimulated) clearOperatorOverride(junctionId);
      else if (hold && userId) await releaseHold(hold.hold_id, userId);
      toast("Hold released. The controller has the junction again.", "info");
      void queryClient.invalidateQueries();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Release refused", "bad");
    }
  };

  if (junctions.isSuccess && !junction) {
    return (
      <div className="ops-page text-center">
        <GlitchText text="NO SUCH JUNCTION" className="ops-h1" />
        <p className="ops-sub mx-auto mt-3">J-{id} is not on the register.</p>
        <Link to="/junctions" className="ops-btn mt-5">
          Back to register
        </Link>
      </div>
    );
  }

  return (
    <div className="ops-page">
      <header className="ops-head">
        <div>
          <Link
            to="/junctions"
            className="ops-label inline-flex items-center gap-1 hover:text-[var(--amber)]"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden /> Register
          </Link>
          <p className="ops-kicker mt-2">
            J-{String(junctionId).padStart(3, "0")} · {junction?.zone ?? "···"}
          </p>
          <Decrypt as="h1" className="ops-h1" text={junction?.name ?? "Acquiring"} />
        </div>
        <div className="flex items-center gap-4">
          {junction ? (
            <div className="text-right">
              <span className="ops-label block">State</span>
              <span className={`ops-value lvl-${junction.congestion_level}`}>
                {junction.congestion_level}
              </span>
            </div>
          ) : null}
          {junction ? (
            <Serial code={`${junction.latitude.toFixed(4)}N ${junction.longitude.toFixed(4)}E`} />
          ) : null}
        </div>
      </header>

      <div className="ops-grid lg:grid-cols-[300px_1fr_340px]">
        <div className="space-y-3">
          <HudFrame label="Phase ring" code="CYCLE">
            <div className="grid place-items-center py-2">
              {roads.isLoading ? (
                <Lattice label="Loading phases" />
              ) : (
                <PhaseRing roads={roadList} now={now} />
              )}
            </div>
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {roadList.map((r) => (
                <li key={r.road_id} className="flex justify-between">
                  <span className={r.is_currently_green ? "ops-green" : "ops-dim"}>
                    {r.is_currently_green ? "▶ " : "  "}
                    {r.direction}
                  </span>
                  <span>
                    {r.green_duration_sec}s{" "}
                    <span className="ops-dim">{r.timing_mode.toLowerCase()}</span>
                  </span>
                </li>
              ))}
            </ul>
          </HudFrame>
          <HudFrame label="Saturation scope" code={`DoS ${avgDos.toFixed(2)}`}>
            <div className="h-24">
              <Scope level={avgDos} hue={avgDos > 0.9 ? "red" : avgDos > 0.7 ? "amber" : "green"} />
            </div>
          </HudFrame>
        </div>

        <div className="space-y-3">
          <HudFrame label="Camera" code={`CAM-${String(junctionId).padStart(3, "0")}`}>
            <CameraFeed junctionId={junctionId} roads={roadList} />
          </HudFrame>
          <HudFrame label="Approach queues" code="MODELLED">
            {model.isLoading ? (
              <Lattice label="Loading model" />
            ) : (
              <ul className="space-y-3">
                {(model.data ?? []).map((m) => (
                  <li key={m.road_id} className="ops-queue">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-sm">{m.direction}</span>
                      <span className="ops-label">
                        {Math.round(m.arrival_rate_vph)} veh/h · DoS{" "}
                        {m.degree_saturation.toFixed(2)}
                      </span>
                    </div>
                    <div
                      className="ops-gauge"
                      aria-label={`${Math.round(m.queue_now)} vehicles queued`}
                    >
                      <i
                        className={
                          m.degree_saturation > 0.9
                            ? "bg-lvl-HIGH"
                            : m.degree_saturation > 0.7
                              ? "bg-lvl-MODERATE"
                              : "bg-lvl-LOW"
                        }
                        style={{ width: `${(m.queue_now / maxQueue) * 100}%` }}
                      />
                      <b
                        style={{ left: `${(m.predicted_queue_next / maxQueue) * 100}%` }}
                        title="Predicted next cycle"
                      />
                    </div>
                    <div className="flex justify-between font-mono text-[0.68rem] ops-dim">
                      <span>
                        Queue {Math.round(m.queue_now)} → {Math.round(m.predicted_queue_next)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <StatusMark ok={m.queue_clears} className="!h-3.5 !w-3.5" />
                        {m.queue_clears ? "clears" : "spills over"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </HudFrame>
          <HudFrame label="Adaptive vs fixed" code={`${cycles.data?.length ?? 0} CYCLES`}>
            <Suspense fallback={<Lattice label="Loading chart" />}>
              {cycles.data && cycles.data.length > 0 ? (
                <CycleChart data={cycles.data} saving={undefined} loading={false} />
              ) : (
                <p className="ops-label">
                  No cycles recorded yet. The model writes one every 12 s.
                </p>
              )}
            </Suspense>
          </HudFrame>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <Spectrum level={avgDos} bars={40} className="!h-10" />
            <MagnetLines rows={3} cols={6} />
          </div>
        </div>

        <div className="space-y-3">
          {hold ? (
            <ElectricBorder color="#ff2d78">
              <div className="ops-panel">
                <p className="ops-kicker">Manual hold active</p>
                <TypeLine
                  className="mt-1 block font-mono text-xs"
                  text={`${roadList.find((r) => r.road_id === hold?.road_id)?.direction ?? "Approach"} held until ${hold ? new Date(hold.ends_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" }) : ""} · ${hold?.reason ?? ""}`}
                />
              </div>
            </ElectricBorder>
          ) : null}
          <HudFrame label="Manual green hold" code="OVERRIDE">
            <div className="space-y-3">
              <div
                role="radiogroup"
                aria-label="Approach to hold green"
                className="ops-seg w-full flex-wrap"
              >
                {roadList.map((r) => (
                  <button
                    key={r.road_id}
                    type="button"
                    role="radio"
                    aria-checked={target === r.road_id}
                    className={`flex-1 ${target === r.road_id ? "is-on" : ""}`}
                    onClick={() => setHoldRoad(r.road_id)}
                  >
                    {r.direction}
                  </button>
                ))}
              </div>
              <ScrubField
                label="Hold for"
                value={holdMin}
                onChange={setHoldMin}
                min={1}
                max={isSimulated ? 3 : 15}
                unit="min"
              />
              {isSimulated ? null : (
                <label className="ops-field block">
                  <span className="ops-label">Reason (logged)</span>
                  <textarea
                    className="mt-1"
                    rows={2}
                    maxLength={200}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <HoldButton
                  tone="green"
                  disabled={!allowed || target === null || reason.trim().length < 3}
                  onHold={() => void doHold()}
                >
                  Hold green
                </HoldButton>
                <button
                  type="button"
                  className="ops-btn"
                  disabled={!allowed}
                  onClick={() => void doRelease()}
                >
                  Release
                </button>
              </div>
              <p className="ops-label">
                The controller keeps this approach green, then hands back.{" "}
                {isSimulated
                  ? "Simulated only."
                  : "Written to signal_holds; the database checks your role."}
              </p>
              {!allowed ? (
                <p className="ops-label ops-amber">Sign in as an operator to hold signals.</p>
              ) : null}
            </div>
          </HudFrame>
          <HudFrame label="Report incident" code="FIELD">
            <IncidentForm junctionId={junctionId} />
          </HudFrame>
        </div>
      </div>
    </div>
  );
}
