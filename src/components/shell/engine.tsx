import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { BROWSER_DRIVES_LOOP, DATA_MODE } from "@/lib/data-mode";
import { simAdvance, simTick } from "@/lib/sim-engine";
import { advanceSignals, runTrafficTick } from "@/lib/traffic.functions";

/*
 * The control loop runs for the whole app, not one page: the model re-solves every 12 s and the
 * signal controller ends and reassigns green phases every 2 s. Holds and incidents set from the
 * Junctions or Incidents pages therefore keep taking effect wherever the operator is.
 */

type Engine = {
  busy: boolean;
  lastRun: number | null;
  switches: number;
  recalculate: () => Promise<void>;
};

const EngineContext = createContext<Engine | null>(null);
const isSimulated = DATA_MODE === "simulated";

export function EngineProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const liveTick = useServerFn(runTrafficTick);
  const liveAdvance = useServerFn(advanceSignals);
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [switches, setSwitches] = useState(0);
  const running = useRef(false);
  const advancing = useRef(false);

  const recalculate = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (isSimulated) simTick();
      else if (BROWSER_DRIVES_LOOP) await liveTick({});
      void queryClient.invalidateQueries();
      setLastRun(Date.now());
    } catch (error) {
      console.error("Traffic tick failed", error);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [liveTick, queryClient]);

  useEffect(() => {
    void recalculate();
    const id = window.setInterval(() => void recalculate(), 12000);
    return () => window.clearInterval(id);
  }, [recalculate]);

  useEffect(() => {
    const run = async () => {
      if (advancing.current) return;
      advancing.current = true;
      try {
        const result = isSimulated
          ? simAdvance()
          : BROWSER_DRIVES_LOOP
            ? ((await liveAdvance({})) as { switched?: number } | undefined)
            : undefined;
        if (result?.switched) {
          setSwitches((n) => n + (result.switched ?? 0));
          void queryClient.invalidateQueries({ queryKey: ["roads"] });
        }
      } catch (error) {
        console.error("Signal controller failed", error);
      } finally {
        advancing.current = false;
      }
    };
    void run();
    const id = window.setInterval(() => void run(), 2000);
    return () => window.clearInterval(id);
  }, [liveAdvance, queryClient]);

  const value = useMemo(
    () => ({ busy, lastRun, switches, recalculate }),
    [busy, lastRun, switches, recalculate],
  );
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): Engine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error("useEngine must be used inside EngineProvider");
  return engine;
}
