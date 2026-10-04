import { useEffect, useState } from "react";

/**
 * Bumps when the page fonts have loaded. Canvas text drawn before then falls back to a system
 * font and stays that way, so anything painted to a canvas should redraw when this changes.
 */
export function useFontsVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let live = true;
    const bump = () => {
      if (live) setVersion((v) => v + 1);
    };
    void Promise.all([
      document.fonts.load('500 14px "Manrope"'),
      document.fonts.load('600 14px "Manrope"'),
    ])
      .then(() => document.fonts.ready)
      .then(bump, bump);
    document.fonts.addEventListener?.("loadingdone", bump);
    return () => {
      live = false;
      document.fonts.removeEventListener?.("loadingdone", bump);
    };
  }, []);
  return version;
}

/** The current time, refreshed every second, for countdowns and signal aspects. */
export function useSecondClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
