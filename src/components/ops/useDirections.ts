import { useEffect, useMemo, useState } from "react";
import type { JunctionForecast } from "@/lib/forecast";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import {
  assessRoute,
  fetchOsrmRoutes,
  junctionsAlongRoute,
  rankRoutes,
  straightLineRoute,
  type OsrmRoute,
  type RouteAssessment,
} from "@/lib/routing";
import type { Endpoint } from "@/components/ops/OpsMap";

type Fetched = { routes: OsrmRoute[]; estimate: boolean; error: string | null };

/**
 * Fetches roads between two points once, then re-prices them whenever the chosen time
 * changes, so dragging the time slider does not hit the routing service again.
 */
export function useDirections(
  from: Endpoint | null,
  to: Endpoint | null,
  forecast: ReadonlyMap<number, JunctionForecast>,
) {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [loading, setLoading] = useState(false);

  const key = from && to ? `${from.lat},${from.lng}>${to.lat},${to.lng}` : null;

  useEffect(() => {
    if (!from || !to) {
      setFetched(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const a: [number, number] = [from.lng, from.lat];
    const b: [number, number] = [to.lng, to.lat];
    fetchOsrmRoutes(a, b, controller.signal)
      .then((routes) => setFetched({ routes: routes.slice(0, 3), estimate: false, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFetched({
          routes: [straightLineRoute(a, b)],
          estimate: true,
          error: error instanceof Error ? error.message : "Routing service unreachable",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The endpoints are fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const assessments = useMemo<RouteAssessment[]>(() => {
    if (!fetched) return [];
    return rankRoutes(
      fetched.routes.map((route) =>
        assessRoute(
          route,
          junctionsAlongRoute(route.coordinates, SEED_JUNCTIONS),
          forecast,
          fetched.estimate,
        ),
      ),
    );
  }, [fetched, forecast]);

  return { assessments, loading, error: fetched?.error ?? null };
}
