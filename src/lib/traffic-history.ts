/**
 * A short memory of real road speeds, so a junction's card can show how the roads around it have
 * been moving over the last few hours. It builds up while the page is open and is kept in the
 * browser (localStorage), so a reload does not start from nothing. It is only what this browser has
 * seen; it is not a record of the whole day.
 */
import type { TrafficSnapshot } from "@/lib/traffic-flow";

export type SpeedSample = { t: number; ratio: number };

const KEY = "traffic-speed-history-v1";
/** About two and a half hours at one reading every 90 seconds. */
export const MAX_SAMPLES = 100;
/** Readings older than this are dropped. */
export const MAX_AGE_MS = 6 * 3600_000;

const history = new Map<number, SpeedSample[]>();
let loaded = false;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Array<[number, number]>>;
    for (const [id, rows] of Object.entries(parsed)) {
      const samples = rows
        .filter((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]))
        .map(([t, ratio]) => ({ t, ratio }));
      if (samples.length > 0) history.set(Number(id), samples);
    }
  } catch {
    // Unreadable or blocked storage: start empty.
  }
}

function save() {
  try {
    const out: Record<string, Array<[number, number]>> = {};
    for (const [id, samples] of history) out[id] = samples.map((s) => [s.t, s.ratio]);
    storage()?.setItem(KEY, JSON.stringify(out));
  } catch {
    // Storage full or blocked: the history simply lives only as long as the page.
  }
}

/** Add one reading for every junction that had one. A repeat of the same reading is ignored. */
export function recordSnapshot(snapshot: TrafficSnapshot) {
  load();
  const cutoff = snapshot.fetchedAtMs - MAX_AGE_MS;
  let added = false;
  for (const flow of snapshot.junctions) {
    if (flow.ratio === null) continue;
    const samples = (history.get(flow.id) ?? []).filter((s) => s.t >= cutoff);
    if (samples[samples.length - 1]?.t === snapshot.fetchedAtMs) continue;
    samples.push({ t: snapshot.fetchedAtMs, ratio: flow.ratio });
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
    history.set(flow.id, samples);
    added = true;
  }
  if (added) save();
}

/** What has been seen around one junction, oldest first. */
export function speedHistory(junctionId: number): SpeedSample[] {
  load();
  return history.get(junctionId) ?? [];
}

/** Forget everything, for tests. */
export function clearSpeedHistory() {
  history.clear();
  loaded = true;
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
