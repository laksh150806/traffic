import { useEffect, useState } from "react";
import { setRealTraffic } from "@/lib/sim-engine";
import { recordSnapshot } from "@/lib/traffic-history";
import type { TrafficSnapshot } from "@/lib/traffic-flow";

const REFRESH_MS = 90_000;

export type LiveTraffic =
  /** Asking the server for the first reading. */
  | { status: "loading" }
  /** The server has no TomTom key: the app runs on its own simulation. */
  | { status: "off" }
  /** Real readings are driving the simulation. */
  | { status: "live"; snapshot: TrafficSnapshot }
  /** The last reading is kept but a newer one could not be fetched. */
  | { status: "stale"; snapshot: TrafficSnapshot };

/**
 * Follows real traffic speeds from /api/live-traffic once a minute and hands each reading to the
 * simulation. A failed refresh keeps the last good reading (the engine itself ignores one older than
 * ten minutes), and with no key on the server nothing changes.
 */
export function useLiveTraffic(enabled: boolean, onUpdate?: () => void): LiveTraffic {
  const [state, setState] = useState<LiveTraffic>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let last: TrafficSnapshot | null = null;
    const load = async () => {
      // A tab nobody is looking at does not spend the server's TomTom allowance.
      if (document.hidden) return;
      try {
        const response = await fetch("/api/live-traffic", { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as TrafficSnapshot | { enabled: false };
        if (controller.signal.aborted) return;
        if (!body.enabled) {
          setRealTraffic(null);
          setState({ status: "off" });
          return;
        }
        // A reading with no road found near any junction is no reading.
        if (!body.junctions.some((j) => j.ratio !== null)) throw new Error("no readings");
        last = body;
        setRealTraffic(body);
        recordSnapshot(body);
        setState({ status: "live", snapshot: body });
        onUpdate?.();
      } catch {
        if (controller.signal.aborted) return;
        setState(last ? { status: "stale", snapshot: last } : { status: "off" });
      }
    };
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    // Catch up as soon as the tab is looked at again.
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // onUpdate changes identity every render; the polling should not restart for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return state;
}
