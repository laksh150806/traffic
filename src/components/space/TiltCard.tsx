import type { PointerEvent, ReactNode } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";

/**
 * Glass card that leans a few degrees toward the pointer and catches a moving
 * highlight. Motion answers the pointer only; it never runs on its own.
 */
export function TiltCard({
  children,
  className = "",
  max = 5,
}: {
  children: ReactNode;
  className?: string;
  /** Maximum tilt in degrees. */
  max?: number;
}) {
  const reduce = useReducedMotion();
  const rx = useSpring(useMotionValue(0), { stiffness: 220, damping: 22, mass: 0.6 });
  const ry = useSpring(useMotionValue(0), { stiffness: 220, damping: 22, mass: 0.6 });
  const gx = useMotionValue(50);
  const gy = useMotionValue(0);
  const glare = useMotionTemplate`radial-gradient(180px circle at ${gx}% ${gy}%, oklch(1 0 0 / 0.14), transparent 70%)`;

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (reduce || event.pointerType === "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width;
    const py = (event.clientY - box.top) / box.height;
    ry.set((px - 0.5) * 2 * max);
    rx.set(-(py - 0.5) * 2 * max);
    gx.set(px * 100);
    gy.set(py * 100);
  };

  const onLeave = () => {
    rx.set(0);
    ry.set(0);
    gy.set(-40);
  };

  return (
    <motion.div
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      className={`relative ${className}`}
    >
      {children}
      {reduce ? null : (
        <motion.span
          aria-hidden
          style={{ backgroundImage: glare }}
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-70"
        />
      )}
    </motion.div>
  );
}
