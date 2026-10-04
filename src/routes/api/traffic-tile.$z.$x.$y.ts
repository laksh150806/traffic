import { createFileRoute } from "@tanstack/react-router";
import { parseTile } from "@/lib/traffic-flow";

/**
 * GET /api/traffic-tile/{z}/{x}/{y}
 *
 * TomTom's coloured traffic-flow tile for the map: green where roads move freely, red where they
 * crawl. The browser asks this route instead of TomTom so the key never leaves the server, and a
 * tile fetched once is kept for a minute so panning around does not spend the daily tile allowance.
 */
const TILE_URL = "https://api.tomtom.com/traffic/map/4/tile/flow/relative";
const FRESH_MS = 60_000;
const MAX_TILES = 400;

type Entry = { at: number; body: ArrayBuffer };
const cache = new Map<string, Entry>();

const headers = {
  "content-type": "image/png",
  "cache-control": "public, max-age=60",
};

export const Route = createFileRoute("/api/traffic-tile/$z/$x/$y")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const key = process.env["TOMTOM_API_KEY"];
        if (!key) return new Response("Live traffic is not set up", { status: 404 });
        const tile = parseTile(params.z, params.x, params.y);
        if (!tile) return new Response("Not a map tile", { status: 400 });

        const id = `${tile.z}/${tile.x}/${tile.y}`;
        const now = Date.now();
        const hit = cache.get(id);
        if (hit && now - hit.at < FRESH_MS) return new Response(hit.body, { headers });

        try {
          const response = await fetch(
            `${TILE_URL}/${id}.png?tileSize=256&thickness=3&key=${key}`,
            {
              signal: AbortSignal.timeout(8000),
            },
          );
          if (!response.ok) return new Response("TomTom has no tile here", { status: 502 });
          const body = await response.arrayBuffer();
          cache.set(id, { at: now, body });
          // Oldest first out: a Map keeps insertion order.
          while (cache.size > MAX_TILES) cache.delete(cache.keys().next().value as string);
          return new Response(body, { headers });
        } catch {
          return new Response("TomTom could not be reached", { status: 502 });
        }
      },
    },
  },
});
