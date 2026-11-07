import { useEffect } from "react";

/**
 * Two small behaviours for the whole page.
 * - Foil tilt: a glass tile under the pointer leans toward it and a light follows, so tiles read as
 *   real surfaces with depth. One delegated listener, fine pointers only, off for reduced motion.
 * - Tab title: while the tab is hidden it reports the jam count, so a control room left in the
 *   background still shows what needs attention.
 */
export function useForgeEffects(jammed: number | null) {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || calm) return;
    let active: HTMLElement | null = null;
    let frame = 0;
    const release = () => {
      if (!active) return;
      active.removeAttribute("data-foil");
      active.style.removeProperty("--rx");
      active.style.removeProperty("--ry");
      active = null;
    };
    const onMove = (event: PointerEvent) => {
      const tile = (event.target as Element | null)?.closest<HTMLElement>(".glass-inset");
      if (tile !== active) release();
      if (!tile) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = tile.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width;
        const y = (event.clientY - box.top) / box.height;
        active = tile;
        tile.setAttribute("data-foil", "");
        tile.style.setProperty("--rx", `${((0.5 - y) * 9).toFixed(2)}deg`);
        tile.style.setProperty("--ry", `${((x - 0.5) * 11).toFixed(2)}deg`);
        tile.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
        tile.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", release);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", release);
      cancelAnimationFrame(frame);
      release();
    };
  }, []);

  useEffect(() => {
    const home = document.title;
    const apply = () => {
      document.title =
        document.hidden && jammed !== null
          ? jammed > 0
            ? `${jammed} jammed. Come back`
            : "Network clear"
          : home;
    };
    document.addEventListener("visibilitychange", apply);
    apply();
    return () => {
      document.removeEventListener("visibilitychange", apply);
      document.title = home;
    };
  }, [jammed]);
}
