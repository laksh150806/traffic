import { AnimatePresence, motion } from "motion/react";
import { Play, Square } from "lucide-react";
import { AnimatedNumber } from "@/components/space/AnimatedNumber";
import type { Caption } from "@/components/ops/useDemoTour";

export function TourCaption({ caption, onStop }: { caption: Caption; onStop: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="panel hud pointer-events-auto absolute inset-x-3 bottom-[132px] z-20 mx-auto max-w-[620px] overflow-hidden px-4 pb-4 pt-3 @xl:bottom-[96px]"
    >
      <div className="flex items-start gap-4">
        <div className="min-w-[5.6rem]">
          <p className="numeric text-2xl leading-none text-foreground">{caption.time}</p>
          <p className="meta-label mt-1">{caption.phase}</p>
        </div>
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={caption.phase + caption.title.replace(/\d+/g, "#")}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="font-display text-sm font-semibold leading-snug">{caption.title}</p>
              <p className="mt-1 hidden text-xs leading-relaxed text-muted-foreground @md:block">
                {caption.body}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
        {caption.jammed !== null ? (
          <div className="hidden text-right sm:block">
            <AnimatedNumber
              value={caption.jammed}
              className={`numeric block text-2xl leading-none ${
                caption.jammed > 0 ? "text-signal-high" : "text-signal-low"
              }`}
            />
            <p className="meta-label mt-1">jammed</p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop the demo"
          className="glass-chip flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <Square className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10" aria-hidden>
        <div
          className="h-full origin-left bg-primary transition-transform duration-300 ease-out"
          style={{ transform: `scaleX(${caption.progress})` }}
        />
      </div>
    </div>
  );
}

/** Offered on the map when everything is flowing, which is the least exciting moment to demo. */
export function TourInvite({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="glass-button pointer-events-auto absolute bottom-[132px] left-1/2 z-20 flex -translate-x-1/2 @xl:bottom-[96px] items-center gap-2.5 px-4 py-2 text-xs font-semibold"
    >
      <Play className="h-3.5 w-3.5" aria-hidden />
      Quiet right now. Watch a day in 40 seconds
    </button>
  );
}
