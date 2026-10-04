import { createFileRoute } from "@tanstack/react-router";
import { parsePoint, parseTomTomRoute, type LiveEta } from "@/lib/route-eta";

/**
 * GET /api/route-eta?from=lat,lng&to=lat,lng
 *
 * TomTom's driving time for a trip with today's traffic in it, for comparing with the model's own
 * estimate. The key stays on the server, only trips inside Chennai are accepted, and an answer is
 * kept for a minute so a page asking again does not spend the daily allowance.
 */
const URL_BASE = "https://api.tomtom.com/routing/1/calculateRoute";
const FRESH_MS = 60_000;
const MAX_ENTRIES = 200;

const cache = new Map<string, { at: number; eta: LiveEta }>();
const noStore = { "cache-control": "no-store" };

export const Route = createFileRoute("/api/route-eta")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = process.env["TOMTOM_API_KEY"];
        if (!key) return Response.json({ enabled: false }, { headers: noStore });

        const url = new URL(request.url);
        const from = parsePoint(url.searchParams.get("from"));
        const to = parsePoint(url.searchParams.get("to"));
        if (!from || !to) {
          return Response.json({ error: "from and to must be points in Chennai" }, { status: 400 });
        }

        const id = [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(4)).join(",");
        const now = Date.now();
        const hit = cache.get(id);
        if (hit && now - hit.at < FRESH_MS) return Response.json(hit.eta, { headers: noStore });

        try {
          const trip = `${from.lat},${from.lng}:${to.lat},${to.lng}`;
          const response = await fetch(
            `${URL_BASE}/${trip}/json?traffic=true&travelMode=car&routeType=fastest&key=${key}`,
            { signal: AbortSignal.timeout(8000) },
          );
          if (!response.ok) {
            return Response.json({ error: "TomTom could not plan this trip" }, { status: 502 });
          }
          const eta = parseTomTomRoute(await response.json(), now);
          if (!eta) return Response.json({ error: "TomTom found no route" }, { status: 502 });
          cache.set(id, { at: now, eta });
          while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
          return Response.json(eta, { headers: noStore });
        } catch {
          return Response.json({ error: "TomTom could not be reached" }, { status: 502 });
        }
      },
    },
  },
});
