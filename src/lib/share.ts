/**
 * What goes in the address bar so a view can be sent to someone: the selected junction, the moment
 * being looked at, the two ends of a trip and which tab is open. Reading a link back is defensive,
 * since anyone can type anything into a URL: every field is checked and a bad one is dropped
 * instead of breaking the page.
 */
export type SharePoint = { lat: number; lng: number; label: string };

export type ShareView = {
  junction?: number;
  /** A moment ahead of now, ms since epoch. */
  atMs?: number;
  from?: SharePoint;
  to?: SharePoint;
  tab?: "explore" | "directions";
};

/** Chennai and its surroundings: a point outside this is not one this app can route. */
const BOUNDS = { south: 12.4, north: 13.6, west: 79.6, east: 80.6 };
const MAX_JUNCTION_ID = 1000;
const MAX_LABEL = 60;
const MAX_AHEAD_MS = 25 * 3600 * 1000;

const round = (n: number) => Number(n.toFixed(5));

function encodePoint(params: URLSearchParams, key: string, point: SharePoint | undefined) {
  if (!point) return;
  params.set(key, `${round(point.lat)},${round(point.lng)}`);
  params.set(`${key}Name`, point.label.slice(0, MAX_LABEL));
}

function decodePoint(params: URLSearchParams, key: string): SharePoint | undefined {
  const raw = params.get(key);
  if (!raw) return undefined;
  const [latText, lngText, ...extra] = raw.split(",");
  if (extra.length > 0 || latText === undefined || lngText === undefined) return undefined;
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < BOUNDS.south || lat > BOUNDS.north || lng < BOUNDS.west || lng > BOUNDS.east) {
    return undefined;
  }
  const label = [...(params.get(`${key}Name`) ?? "")]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join("")
    .slice(0, MAX_LABEL);
  return { lat, lng, label: label.trim() || "Shared place" };
}

/** The query string (without the question mark) for a view. A moment that has passed is left out. */
export function encodeView(view: ShareView, nowMs: number): string {
  const params = new URLSearchParams();
  if (view.junction !== undefined) params.set("j", String(view.junction));
  if (view.atMs !== undefined && view.atMs > nowMs) {
    params.set("t", String(Math.round(view.atMs / 60_000)));
  }
  encodePoint(params, "from", view.from);
  encodePoint(params, "to", view.to);
  if (view.tab === "directions") params.set("tab", "directions");
  return params.toString();
}

export function decodeView(search: string, nowMs: number): ShareView {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const view: ShareView = {};

  const junction = Number(params.get("j"));
  if (
    params.get("j") &&
    Number.isInteger(junction) &&
    junction > 0 &&
    junction <= MAX_JUNCTION_ID
  ) {
    view.junction = junction;
  }

  const minutes = Number(params.get("t"));
  if (params.get("t") && Number.isFinite(minutes)) {
    const atMs = Math.round(minutes) * 60_000;
    if (atMs > nowMs && atMs <= nowMs + MAX_AHEAD_MS) view.atMs = atMs;
  }

  const from = decodePoint(params, "from");
  const to = decodePoint(params, "to");
  if (from) view.from = from;
  if (to) view.to = to;
  if (params.get("tab") === "directions") view.tab = "directions";
  return view;
}
