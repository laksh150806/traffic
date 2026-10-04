// Fetches the position of every traffic signal OpenStreetMap has in the Chennai area and writes
// src/lib/osm-signals.json, which the app reads. Run with: node scripts/fetch-osm-signals.mjs
// The data is crowd-sourced map data (c) OpenStreetMap contributors, ODbL.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BBOX = "12.55,79.95,13.42,80.40"; // south, west, north, east: Chennai and its outskirts
const QUERY = `[out:json][timeout:80];node["highway"="traffic_signals"](${BBOX});out skel;`;
// Public Overpass servers are often busy; try each in turn.
const SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

let body = null;
for (const server of SERVERS) {
  try {
    const res = await fetch(`${server}?data=${encodeURIComponent(QUERY)}`, {
      headers: { "user-agent": "traffic-course-project/1.0 (student project)" },
      signal: AbortSignal.timeout(100_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
    console.log("fetched from", server);
    break;
  } catch (error) {
    console.log("failed", server, String(error));
  }
}
if (!body) {
  console.error("No Overpass server answered.");
  process.exit(1);
}

const points = body.elements
  .filter((e) => e.type === "node")
  .map((e) => [Number(e.lat.toFixed(6)), Number(e.lon.toFixed(6))])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const out = {
  source: "OpenStreetMap, highway=traffic_signals",
  licence: "ODbL, (c) OpenStreetMap contributors",
  fetchedAt: new Date().toISOString(),
  bbox: BBOX,
  count: points.length,
  signals: points,
};
fs.writeFileSync(path.join(root, "src/lib/osm-signals.json"), JSON.stringify(out) + "\n");
console.log("wrote", points.length, "signals");
