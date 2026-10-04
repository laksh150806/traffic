import { createFileRoute } from "@tanstack/react-router";
import type { TrafficSnapshot } from "@/lib/traffic-flow";

/**
 * GET /api/live-traffic
 *
 * Real traffic speed around every junction, from TomTom's flow tiles. The answer is shared for
 * a minute between everyone asking, so the tile quota is used by the server, not by each browser.
 * With no TOMTOM_API_KEY it answers { enabled: false } and the app keeps to its own simulation.
 */
// A page left open for a day asks for 18 tiles about every 90 seconds, which keeps this well inside
// TomTom's free tile allowance. Nobody looking means nobody asking, so an idle server spends none.
const CACHE_MS = 90_000;

let cached: { at: number; body: TrafficSnapshot } | null = null;
let inFlight: Promise<TrafficSnapshot> | null = null;

export const Route = createFileRoute("/api/live-traffic")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env["TOMTOM_API_KEY"];
        if (!key)
          return Response.json({ enabled: false }, { headers: { "cache-control": "no-store" } });
        const now = Date.now();
        if (cached && now - cached.at < CACHE_MS) {
          return Response.json(cached.body, { headers: { "cache-control": "no-store" } });
        }
        try {
          inFlight ??= import("@/lib/flow-tiles.server").then(({ fetchTrafficSnapshot }) =>
            fetchTrafficSnapshot(key),
          );
          const body = await inFlight;
          // Nothing came back (a wrong key, an outage): say so, rather than report a reading of nothing.
          if (body.tilesOk === 0) {
            return Response.json(
              { enabled: true, error: "TomTom returned no traffic data" },
              { status: 502, headers: { "cache-control": "no-store" } },
            );
          }
          // A reading where most tiles failed is worse than the last good one.
          if (!cached || body.tilesOk * 2 >= body.tilesTotal) cached = { at: Date.now(), body };
          return Response.json(cached.body, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("Live traffic failed", error);
          return Response.json(
            { enabled: true, error: "TomTom could not be reached" },
            { status: 502, headers: { "cache-control": "no-store" } },
          );
        } finally {
          inFlight = null;
        }
      },
    },
  },
});
