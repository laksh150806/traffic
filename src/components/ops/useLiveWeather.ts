import { useEffect, useState } from "react";
import { fetchWeather, getWeather, setWeather, type WeatherSnapshot } from "@/lib/weather";

const REFRESH_MS = 15 * 60_000;

/**
 * Keeps Chennai's real weather up to date for the simulation, and says when it changed so the
 * panels can be redrawn. On any failure the last good reading stays, and with none at all the
 * simulation simply runs dry, as it always did.
 */
export function useLiveWeather(enabled: boolean, onChange?: () => void): WeatherSnapshot | null {
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(getWeather);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let last = "";
    const load = async () => {
      if (document.hidden) return;
      try {
        const next = await fetchWeather(fetch, Date.now(), controller.signal);
        if (!next || controller.signal.aborted) return;
        setWeather(next);
        setSnapshot(next);
        const key = `${next.current.precipMm}|${next.hourly.map((h) => h.precipMm).join(",")}`;
        if (key !== last) {
          last = key;
          onChange?.();
        }
      } catch {
        // Offline, blocked or rate-limited: keep what we have.
      }
    };
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // onChange is a fresh function each render; the refresh does not need to restart for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return snapshot;
}
