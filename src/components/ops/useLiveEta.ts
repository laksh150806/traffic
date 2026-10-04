import { useEffect, useState } from "react";
import type { LiveEta } from "@/lib/route-eta";

const REFRESH_MS = 120_000;

const point = (p: { lat: number; lng: number }) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/**
 * TomTom's driving time for the trip being planned, with today's traffic in it. It is asked for
 * only while a trip is set and real traffic is on, and again every two minutes. A failure leaves it
 * empty: the model's own estimate is always shown and does not depend on it.
 */
export function useLiveEta(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | null,
  enabled: boolean,
): LiveEta | null {
  const [eta, setEta] = useState<LiveEta | null>(null);
  const fromKey = from ? point(from) : null;
  const toKey = to ? point(to) : null;

  useEffect(() => {
    setEta(null);
    if (!enabled || !fromKey || !toKey) return;
    const controller = new AbortController();
    const load = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(
          `/api/route-eta?from=${encodeURIComponent(fromKey)}&to=${encodeURIComponent(toKey)}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const body = (await response.json()) as LiveEta | { enabled: false };
        if (!controller.signal.aborted && "travelSec" in body) setEta(body);
      } catch {
        // Offline or refused: the model's estimate stands alone.
      }
    };
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [enabled, fromKey, toKey]);

  return eta;
}
