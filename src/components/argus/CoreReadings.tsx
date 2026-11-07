import { SplitFlap } from "./SplitFlap";

export type Reading = {
  label: string;
  value: string;
  /** 0..1, how far along its scale the reading sits; drawn as the lit part of the leader. */
  share: number;
  hot?: boolean | undefined;
  note?: string | undefined;
};

/**
 * The network in four lines. Each reading has a leader running out to the right; how much of the
 * leader is lit is the reading on its own scale, so the column reads at a glance like a bar chart.
 */
export function CoreReadings({ readings }: { readings: Reading[] }) {
  return (
    <section aria-label="Network now" className="core">
      <h2 className="rail-head">Network</h2>
      <dl className="space-y-1">
        {readings.map((r) => (
          <div key={r.label} className="core-row" data-hot={r.hot ? "" : undefined} title={r.note}>
            <dt className="core-label">{r.label}</dt>
            <dd className="core-value">
              <SplitFlap text={r.value} pad={5} className="flap-sm" label={`${r.value}`} />
            </dd>
            <span className="core-leader" aria-hidden>
              <span style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, r.share))})` }} />
            </span>
          </div>
        ))}
      </dl>
    </section>
  );
}
