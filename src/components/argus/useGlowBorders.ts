import { useEffect } from "react";

/**
 * Glowing borders: every `.hx` surface lights the stretch of its border nearest the pointer.
 * One pointer listener for the page, at most one layout read per frame, mouse only.
 */
export function useGlowBorders() {
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let raf = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      raf = 0;
      for (const el of document.querySelectorAll<HTMLElement>(".hx, .deck-col .panel")) {
        const box = el.getBoundingClientRect();
        // Only surfaces within reach of the pointer glow.
        const dx = Math.max(box.left - x, 0, x - box.right);
        const dy = Math.max(box.top - y, 0, y - box.bottom);
        const near = Math.max(0, 1 - Math.hypot(dx, dy) / 140);
        el.style.setProperty("--gx", `${x - box.left}px`);
        el.style.setProperty("--gy", `${y - box.top}px`);
        el.style.setProperty("--ga", near.toFixed(2));
      }
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      x = event.clientX;
      y = event.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);
}
