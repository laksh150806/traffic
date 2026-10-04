/**
 * Server side only: downloads TomTom's vector traffic-flow tiles for the area the junctions cover,
 * decodes them and works out the traffic speed around each junction. The key stays here, so it is
 * never sent to the browser.
 */
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import {
  FLOW_ZOOM,
  junctionFlow,
  tilesFor,
  type FlowSegment,
  type TileId,
  type TrafficSnapshot,
} from "@/lib/traffic-flow";

const TILE_URL = "https://api.tomtom.com/traffic/map/4/tile/flow/relative";
const TILE_TIMEOUT_MS = 8000;

/** Read one flow tile into road segments. The layer carries traffic_level, current over free flow. */
export function decodeFlowTile(buffer: Uint8Array, tile: TileId, zoom = FLOW_ZOOM): FlowSegment[] {
  const layer = new VectorTile(new PbfReader(buffer)).layers["Traffic flow"];
  if (!layer) return [];
  const segments: FlowSegment[] = [];
  for (let i = 0; i < layer.length; i += 1) {
    const feature = layer.feature(i);
    const level = Number(feature.properties["traffic_level"]);
    if (!Number.isFinite(level)) continue;
    const geometry = feature.toGeoJSON(tile.x, tile.y, zoom).geometry;
    const lines =
      geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "MultiLineString"
          ? geometry.coordinates
          : [];
    for (const line of lines) {
      segments.push({
        ratio: level,
        line: line.map(([lng, lat]) => [lng as number, lat as number] as [number, number]),
        roadType: String(feature.properties["road_type"] ?? ""),
      });
    }
  }
  return segments;
}

async function fetchTile(
  key: string,
  tile: TileId,
  fetcher: typeof fetch,
): Promise<FlowSegment[] | null> {
  try {
    const response = await fetcher(`${TILE_URL}/${FLOW_ZOOM}/${tile.x}/${tile.y}.pbf?key=${key}`, {
      signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return decodeFlowTile(new Uint8Array(await response.arrayBuffer()), tile);
  } catch {
    return null;
  }
}

/** The speed ratio around every junction right now. */
export async function fetchTrafficSnapshot(
  key: string,
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<TrafficSnapshot> {
  const tiles = tilesFor(SEED_JUNCTIONS);
  const results = await Promise.all(tiles.map((tile) => fetchTile(key, tile, fetcher)));
  const segments = results.flatMap((r) => r ?? []);
  return {
    enabled: true,
    fetchedAtMs: nowMs,
    source: "tomtom",
    tilesOk: results.filter((r) => r !== null).length,
    tilesTotal: tiles.length,
    junctions: SEED_JUNCTIONS.map((j) => junctionFlow(j.id, j.lat, j.lng, segments)),
  };
}
