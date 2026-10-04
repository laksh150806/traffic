import { useEffect, useMemo, useState } from "react";
import { forecastJunction, type JunctionForecast } from "@/lib/forecast";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import {
  RoutingError,
  assessRoute,
  fetchOsrmRoutes,
  junctionsAlongRoute,
  rankRoutes,
  straightLineRoute,
  type OsrmRoute,
  type RouteAssessment,
  type RouteJunction,
} from "@/lib/routing";
import type { Endpoint } from "@/components/ops/OpsMap";

type Fetched = {
  routes: OsrmRoute[];
  estimate: boolean;
  error: string | null;
  kind: RoutingError["kind"] | null;
};

/** What the trip is priced against besides the clock. */
export type Pricing = {
  /** Demand multiplier from a forced scenario, applied to a trip that starts now. */
  factor?: number;
  /** Junction id to the time (ms) its blocked lane clears. */
  incidentEnds: ReadonlyMap<number, number>;
  /** Share of normal capacity every approach has right now (wet roads), applied to a trip that starts now. */
  capacityScale?: number;
};

const INDEX_BY_ID = new Map(SEED_JUNCTIONS.map((j, index) => [j.id, index]));

/**
 * Fetches roads between two points once, then re-prices them whenever the departure
 * time or scenario changes, so dragging the time slider does not hit the routing
 * service again. Each junction is priced for the time the vehicle should reach it.
 */
export function useDirections(
  from: Endpoint | null,
  to: Endpoint | null,
  departAt: Date,
  pricing: Pricing,
) {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [loading, setLoading] = useState(false);

  const key = from && to ? `${from.lat},${from.lng}>${to.lat},${to.lng}` : null;

  useEffect(() => {
    // Whatever was drawn belongs to the previous pair of endpoints.
    setFetched(null);
    if (!from || !to) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const a: [number, number] = [from.lng, from.lat];
    const b: [number, number] = [to.lng, to.lat];
    fetchOsrmRoutes(a, b, controller.signal)
      .then((routes) =>
        setFetched({ routes: routes.slice(0, 3), estimate: false, error: null, kind: null }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const kind = error instanceof RoutingError ? error.kind : "unreachable";
        const message = error instanceof Error ? error.message : "Routing service unreachable";
        // With no road route there is nothing honest to estimate; otherwise fall back to a straight line.
        setFetched({
          routes: kind === "no-route" ? [] : [straightLineRoute(a, b)],
          estimate: kind !== "no-route",
          error: message,
          kind,
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The endpoints are fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Which junctions each road passes does not depend on the time, so work it out once per fetch.
  const matched = useMemo<RouteJunction[][]>(
    () =>
      fetched ? fetched.routes.map((r) => junctionsAlongRoute(r.coordinates, SEED_JUNCTIONS)) : [],
    [fetched],
  );

  const departMs = departAt.getTime();
  const assessments = useMemo<RouteAssessment[]>(() => {
    if (!fetched) return [];
    const priceAt = (junctionId: number, secondsIn: number): JunctionForecast | undefined => {
      const index = INDEX_BY_ID.get(junctionId);
      if (index === undefined) return undefined;
      const arrivalMs = departMs + secondsIn * 1000;
      const incidents = new Set<number>();
      for (const [id, until] of pricing.incidentEnds) if (until > arrivalMs) incidents.add(id);
      return forecastJunction(index, new Date(arrivalMs), {
        ...(pricing.factor === undefined ? {} : { factor: pricing.factor }),
        ...(pricing.capacityScale === undefined ? {} : { capacityScale: pricing.capacityScale }),
        incidents,
      });
    };
    return rankRoutes(
      fetched.routes.map((route, i) =>
        assessRoute(route, matched[i] ?? [], priceAt, fetched.estimate),
      ),
    );
  }, [fetched, matched, departMs, pricing]);

  return { assessments, loading, error: fetched?.error ?? null, errorKind: fetched?.kind ?? null };
}
