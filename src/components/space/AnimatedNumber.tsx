import { useEffect } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";

/** Eases to a new value instead of snapping, so live readouts feel continuous. */
export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = "",
  className = "",
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { stiffness: 110, damping: 24, mass: 0.8 });
  const text = useTransform(spring, (v) => `${v.toFixed(decimals)}${suffix}`);

  useEffect(() => {
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);

  return <motion.span className={className}>{text}</motion.span>;
}
