import { CameraFeed } from "@/components/fx/CameraFeed";
import { RollNumber } from "@/components/fx/text";
import type { ApproachModelState, RoadState } from "@/lib/traffic-types";

export type DeckHold = { roadId: number; untilMs: number } | null;

type Props = {
  junctionId: number;
  roads: RoadState[];
  model: ApproachModelState[];
  now: number;
  hold: DeckHold;
  canOperate: boolean;
  onGive: (roadId: number) => void;
  onRelease: () => void;
};

const word = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const clock = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

function why(m: ApproachModelState | undefined, green: boolean): string {
  if (!m) return "Waiting for the first model run";
  const q = Math.round(m.queue_now);
  if (!m.queue_clears)
    return `${q} queued and it would not clear, so this approach gets a longer green`;
  if (m.degree_saturation < 0.4) return `Light demand (${q} queued), so the green is kept short`;
  return green
    ? `${q} queued, clears inside this green`
    : `${q} queued, will clear on its next green`;
}

/** The adaptive controller made visible: what it decided, why, what it saves, and one-tap control. */
export function AdaptiveDeck({
  junctionId,
  roads,
  model,
  now,
  hold,
  canOperate,
  onGive,
  onRelease,
}: Props) {
  const byRoad = new Map(model.map((m) => [m.road_id, m]));
  const planGreen = (r: RoadState) => byRoad.get(r.road_id)?.green_sec ?? r.green_duration_sec;
  const total = Math.max(
    1,
    roads.reduce((s, r) => s + planGreen(r), 0),
  );
  const rateSum = model.reduce((s, m) => s + m.arrival_rate_vph, 0);
  const saved = rateSum
    ? model.reduce(
        (s, m) =>
          s + (m.predicted_delay_fixed_sec - m.predicted_delay_adaptive_sec) * m.arrival_rate_vph,
        0,
      ) / rateSum
    : 0;
  const fixedAvg = rateSum
    ? model.reduce((s, m) => s + m.predicted_delay_fixed_sec * m.arrival_rate_vph, 0) / rateSum
    : 0;
  const pct = fixedAvg > 0 ? Math.round((saved / fixedAvg) * 100) : 0;
  const maxDelay = Math.max(
    1,
    ...model.flatMap((m) => [m.predicted_delay_adaptive_sec, m.predicted_delay_fixed_sec]),
  );

  const gi = roads.findIndex((r) => r.is_currently_green);
  const cur = gi >= 0 ? roads[gi] : undefined;
  const started = cur?.phase_started_at ? Date.parse(cur.phase_started_at) : NaN;
  const greenLen = cur ? planGreen(cur) : 0;
  const elapsed = Number.isFinite(started) ? Math.max(0, (now - started) / 1000) : 0;
  const left = Math.max(0, greenLen - elapsed);
  const next = roads.length ? roads[(Math.max(gi, 0) + 1) % roads.length] : undefined;
  const holdLeft = hold ? Math.max(0, (hold.untilMs - now) / 1000) : 0;
  const held = hold && holdLeft > 0 ? roads.find((r) => r.road_id === hold.roadId) : undefined;

  return (
    <section className="deck" aria-label="Adaptive signal control">
      <div className="deck-cam">
        <CameraFeed junctionId={junctionId} roads={roads} />
      </div>

      <div className="deck-ctl">
        <div className="deck-top">
          <div>
            <p className="ops-kicker">Adaptive controller</p>
            <p className={`deck-state ${held ? "is-held" : ""}`}>
              <i aria-hidden />
              {held
                ? `Operator hold · ${word(held.direction)} · ${clock(holdLeft)}`
                : "Running adaptive · live"}
            </p>
          </div>
          <div
            className="deck-save"
            title="Modelled wait per vehicle: adaptive plan against this junction's fixed-time reference"
          >
            <span className="ops-label block">vs fixed timer</span>
            {Math.abs(saved) < 0.5 ? (
              <>
                <span className="ops-value">On par</span>
                <span className="ops-label block">
                  {fixedAvg > 25
                    ? "saturated: no timing can clear it"
                    : "demand suits the fixed timer"}
                </span>
              </>
            ) : (
              <>
                <span className={`ops-value ${saved >= 0 ? "ops-green" : "ops-red"}`}>
                  {saved >= 0 ? "−" : "+"}
                  <RollNumber value={Math.abs(saved).toFixed(1)} />s
                </span>
                <span className="ops-label block">
                  {pct >= 0 ? `${pct}% less wait` : `${Math.abs(pct)}% more wait`} per vehicle
                </span>
              </>
            )}
          </div>
        </div>

        <div
          className="deck-plan"
          role="img"
          aria-label="Green time the controller gave each approach this cycle"
        >
          {roads.map((r) => {
            const on = r.is_currently_green;
            const g = planGreen(r);
            return (
              <div
                key={r.road_id}
                className={`deck-seg ${on ? "is-on" : ""}`}
                style={{ flexGrow: g }}
              >
                <i
                  style={{
                    transform: `scaleX(${on && greenLen ? Math.min(1, elapsed / greenLen) : 0})`,
                  }}
                />
                <span>{r.direction.slice(0, 1)}</span>
                <b>{Math.round(g)}s</b>
              </div>
            );
          })}
        </div>
        <p className="deck-next">
          {cur ? (
            <>
              <strong>{word(cur.direction)}</strong> green, <strong>{Math.ceil(left)}s</strong>{" "}
              left. Next: <strong>{next ? word(next.direction) : "-"}</strong>. Cycle{" "}
              {Math.round(total)}s, re-planned every 12s from the queues.
            </>
          ) : (
            "All red. Clearance before the next green."
          )}
        </p>

        <ul className="deck-arms">
          {roads.map((r) => {
            const m = byRoad.get(r.road_id);
            const isHeld = held?.road_id === r.road_id;
            return (
              <li key={r.road_id} className={r.is_currently_green ? "is-green" : ""}>
                <div className="deck-arm-head">
                  <span className="deck-lamp" aria-hidden />
                  <strong>{word(r.direction)}</strong>
                  <span className="ops-label">
                    {Math.round(r.vehicle_count)} veh · {m ? Math.round(m.arrival_rate_vph) : "-"}/h
                  </span>
                  <button
                    type="button"
                    className={`ops-btn deck-give ${isHeld ? "solid" : ""}`}
                    disabled={!canOperate || isHeld}
                    onClick={() => onGive(r.road_id)}
                    title={
                      canOperate ? "Hold the green here for 2 minutes" : "Sign in as an operator"
                    }
                  >
                    {isHeld ? "Holding" : "Give green"}
                  </button>
                </div>
                <p className="deck-why">{why(m, r.is_currently_green)}</p>
                {m ? (
                  <div
                    className="deck-delay"
                    aria-label={`Wait per vehicle: adaptive ${Math.round(m.predicted_delay_adaptive_sec)} seconds, fixed ${Math.round(m.predicted_delay_fixed_sec)} seconds`}
                  >
                    <span className="ops-label">wait</span>
                    <div>
                      <i
                        className="fx"
                        style={{ width: `${(m.predicted_delay_fixed_sec / maxDelay) * 100}%` }}
                      />
                      <i
                        className="ad"
                        style={{ width: `${(m.predicted_delay_adaptive_sec / maxDelay) * 100}%` }}
                      />
                    </div>
                    <span className="ops-label">
                      {Math.round(m.predicted_delay_adaptive_sec)}s{" "}
                      <s>{Math.round(m.predicted_delay_fixed_sec)}s</s>
                    </span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="deck-foot">
          {held ? (
            <button type="button" className="ops-btn solid" onClick={onRelease}>
              Hand back to adaptive
            </button>
          ) : (
            <p className="ops-label">
              {canOperate
                ? "Give green holds one approach for 2 minutes, then the controller takes over again."
                : "Sign in as an operator to take manual control."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
