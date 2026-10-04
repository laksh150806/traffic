import "leaflet/dist/leaflet.css";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { Minus, Plus } from "lucide-react";
import { neighbourInDirection, type NavDirection } from "@/lib/map-nav";
import { FitRun, FlagLayer, PriorityLayer } from "@/components/ops/MapOverlays";
import type { RouteAssessment } from "@/lib/routing";
import type { OperatorOverride, PriorityRunStatus, RoadIncident } from "@/lib/sim-engine";
import type { JunctionSummary } from "@/lib/traffic-types";

/** Canvas paths cannot read CSS variables, so these mirror the signal tokens as hex. */
const LEVEL_COLOR: Record<string, string> = {
  LOW: "#4ade80",
  MODERATE: "#fbbf24",
  HIGH: "#fb4d6a",
};

const ROUTE_COLOR = "#60a5fa";
const ALT_COLOR = "#94a3b8";

export type Endpoint = { lat: number; lng: number; label: string };

type Props = {
  junctions: JunctionSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  routes: RouteAssessment[];
  routeIndex: number;
  from: Endpoint | null;
  to: Endpoint | null;
  /** When set, the next click on the map picks that endpoint. */
  pick: "from" | "to" | null;
  onPick: (which: "from" | "to", point: { lat: number; lng: number }) => void;
  onChooseRoute: (index: number) => void;
  /** An ambulance or green wave in progress, drawn with the signals clearing for it. */
  run?: PriorityRunStatus | null;
  /** Junctions where an operator holds a green, and reported road problems. */
  overrides?: OperatorOverride[];
  incidents?: RoadIncident[];
  /** Colour the roads by real traffic speed (TomTom), through the server so the key stays private. */
  trafficOverlay?: boolean;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const isTouchOnly = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/** A ring that spreads out from a jammed junction. The motion is CSS, see .pulse-ring. */
const PULSE_ICON = L.divIcon({
  className: "pulse-ring",
  html: "<span></span><span></span>",
  iconSize: [56, 56],
  iconAnchor: [28, 28],
});

/**
 * The core of the network, ignoring the few far-out junctions on the Chengalpattu and Ennore
 * roads, so the first view is the city and not half of Tamil Nadu.
 */
function coreBounds(junctions: JunctionSummary[]) {
  const trim = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const cut = Math.floor(sorted.length * 0.04);
    return [sorted[cut] ?? sorted[0] ?? 0, sorted[sorted.length - 1 - cut] ?? 0] as const;
  };
  const [south, north] = trim(junctions.map((j) => j.latitude));
  const [west, east] = trim(junctions.map((j) => j.longitude));
  return L.latLngBounds([south, west], [north, east]);
}

/** Frame the whole network once, then follow the selection and any route. */
function Camera({
  junctions,
  selectedId,
  routes,
  routeIndex,
}: Pick<Props, "junctions" | "selectedId" | "routes" | "routeIndex">) {
  const map = useMap();
  const framed = useRef(false);
  const lastSelected = useRef<number | null>(null);
  const firstSelection = useRef(true);

  useEffect(() => {
    const container = map.getContainer();
    container.setAttribute("role", "region");
    container.setAttribute(
      "aria-label",
      "Map of Chennai junctions. Arrow keys move the map. Hold Shift and press an arrow key to jump to the nearest junction in that direction. The search box and the junction list also pick one.",
    );
  }, [map]);

  // Fit once the map has a real size. The panel is laid out after the lazy map mounts, and a fit
  // against a tiny box zooms out to the whole state.
  useEffect(() => {
    if (framed.current || junctions.length === 0) return;
    const container = map.getContainer();
    const fit = () => {
      if (framed.current) return;
      if (container.clientWidth < 240 || container.clientHeight < 240) return;
      framed.current = true;
      map.invalidateSize({ animate: false });
      map.fitBounds(coreBounds(junctions), {
        paddingTopLeft: [40, 84],
        paddingBottomRight: [64, 120],
        maxZoom: 12,
        animate: false,
      });
    };
    fit();
    if (framed.current) return;
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [junctions, map]);

  // The set of roads, regardless of the order they are ranked in, decides when to refit.
  const routeKey = [...routes.map((r) => r.id)].sort().join("#");
  useEffect(() => {
    const chosen = routes[routeIndex] ?? routes[0];
    if (!chosen || chosen.route.coordinates.length < 2) return;
    map.fitBounds(
      L.latLngBounds(chosen.route.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])),
      { padding: [72, 72], maxZoom: 15, animate: !prefersReducedMotion() },
    );
    // Only refit when the set of routes changes, not when the user flips between them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, map]);

  useEffect(() => {
    if (selectedId === null || selectedId === lastSelected.current) return;
    lastSelected.current = selectedId;
    // The junction picked for the first screen should not pull the camera off the city view.
    if (firstSelection.current) {
      firstSelection.current = false;
      return;
    }
    const j = junctions.find((item) => item.junction_id === selectedId);
    if (!j || routes.length > 0) return;
    const zoom = Math.max(map.getZoom(), 13);
    if (prefersReducedMotion()) map.setView([j.latitude, j.longitude], zoom, { animate: false });
    else map.flyTo([j.latitude, j.longitude], zoom, { duration: 0.8 });
  }, [selectedId, junctions, routes.length, map]);

  return null;
}

const NAV_KEYS: Record<string, NavDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * Keyboard route between junctions. The markers are drawn on a canvas and cannot take focus, so
 * Shift plus an arrow key on the focused map selects the nearest junction that way (plain arrows
 * still pan the map).
 */
function KeyboardNav({
  junctions,
  selectedId,
  onSelect,
}: Pick<Props, "junctions" | "selectedId" | "onSelect">) {
  const map = useMap();
  const latest = useRef({ junctions, selectedId, onSelect });
  useEffect(() => {
    latest.current = { junctions, selectedId, onSelect };
  }, [junctions, selectedId, onSelect]);

  useEffect(() => {
    const container = map.getContainer();
    const onKey = (event: KeyboardEvent) => {
      const direction = NAV_KEYS[event.key];
      if (!direction || !event.shiftKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const { junctions: list, selectedId: current, onSelect: select } = latest.current;
      const from = list.find((j) => j.junction_id === current);
      const centre = map.getCenter();
      const origin = from ?? { latitude: centre.lat, longitude: centre.lng };
      const next = neighbourInDirection(list, origin, direction);
      if (next) select(next.junction_id);
    };
    container.addEventListener("keydown", onKey, true);
    return () => container.removeEventListener("keydown", onKey, true);
  }, [map]);
  return null;
}

function ClickToPick({ pick, onPick }: Pick<Props, "pick" | "onPick">) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().style.cursor = pick ? "crosshair" : "";
    return () => {
      map.getContainer().style.cursor = "";
    };
  }, [pick, map]);
  useMapEvents({
    click: (event) => {
      if (pick) onPick(pick, { lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

/** Zoom buttons that work with a keyboard and a touch screen, not only the scroll wheel. */
function ZoomButtons() {
  const map = useMap();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A click on a button must not also be a click on the map beneath it (it would drop a pin).
    if (box.current) {
      L.DomEvent.disableClickPropagation(box.current);
      L.DomEvent.disableScrollPropagation(box.current);
    }
  }, []);
  return (
    <div
      ref={box}
      className="absolute right-3 top-1/2 z-[1000] flex -translate-y-1/2 flex-col gap-1.5"
    >
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => map.zoomIn()}
        className="glass-chip flex h-11 w-11 items-center justify-center"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => map.zoomOut()}
        className="glass-chip flex h-11 w-11 items-center justify-center"
      >
        <Minus className="h-4 w-4" />
      </button>
    </div>
  );
}

type MarkerProps = {
  id: number;
  lat: number;
  lng: number;
  name: string;
  zone: string;
  level: string;
  avg: number;
  selected: boolean;
  crossed: boolean;
  dim: number;
  onSelect: (id: number) => void;
};

/**
 * One junction. Memoised with stable props so a refresh that changes nothing for this
 * junction does not touch its Leaflet layer (there are 69 of them).
 */
const JunctionMarker = memo(function JunctionMarker({
  id,
  lat,
  lng,
  name,
  zone,
  level,
  avg,
  selected,
  crossed,
  dim,
  onSelect,
}: MarkerProps) {
  const color = LEVEL_COLOR[level] ?? "#4ade80";
  const base = 5 + Math.min(1, avg / 70) * 4;
  const center = useMemo<[number, number]>(() => [lat, lng], [lat, lng]);
  const pathOptions = useMemo(
    () => ({
      color: selected || crossed ? "#ffffff" : color,
      fillColor: color,
      fillOpacity: 0.85 * dim,
      opacity: dim,
      weight: selected ? 3 : crossed ? 2.5 : 1.5,
      // A click on a junction must not also count as a click on the map underneath.
      bubblingMouseEvents: false,
    }),
    [color, selected, crossed, dim],
  );
  const handlers = useMemo(() => ({ click: () => onSelect(id) }), [id, onSelect]);
  const halo = useMemo(
    () => ({
      stroke: false,
      fillColor: color,
      fillOpacity: (level === "HIGH" ? 0.26 : 0.16) * dim,
      interactive: false,
    }),
    [color, level, dim],
  );

  return (
    <>
      {level !== "LOW" ? (
        <CircleMarker
          center={center}
          radius={base + (level === "HIGH" ? 16 : 10)}
          pathOptions={halo}
          interactive={false}
        />
      ) : null}
      {level === "HIGH" && dim === 1 ? (
        <Marker position={center} icon={PULSE_ICON} interactive={false} keyboard={false} />
      ) : null}
      <CircleMarker
        center={center}
        radius={selected ? base + 4 : crossed ? base + 2 : base}
        pathOptions={pathOptions}
        eventHandlers={handlers}
      >
        <Tooltip direction="top" offset={[0, -8]} opacity={1}>
          <span className="font-medium">{name}</span>
          <br />
          {zone}, {level.toLowerCase()}, avg {avg} vehicles
        </Tooltip>
      </CircleMarker>
    </>
  );
});

const NONE_OVERRIDES: OperatorOverride[] = [];
const NONE_INCIDENTS: RoadIncident[] = [];
const ROUTE_CASING = { color: "#0b1030", weight: 10, opacity: 0.9, bubblingMouseEvents: false };

export default function OpsMap({
  junctions,
  selectedId,
  onSelect,
  routes,
  routeIndex,
  from,
  to,
  pick,
  onPick,
  onChooseRoute,
  run = null,
  overrides = NONE_OVERRIDES,
  incidents = NONE_INCIDENTS,
  trafficOverlay = false,
}: Props) {
  const active = routes[routeIndex] ?? null;
  const onRoute = useMemo(() => new Set(active?.junctions.map((j) => j.junctionId)), [active]);

  // Keep the handler the markers see stable even though the parent recreates it each render.
  const selectRef = useRef(onSelect);
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);
  const handleSelect = useCallback((id: number) => selectRef.current(id), []);

  const touchOnly = useMemo(isTouchOnly, []);

  return (
    <MapContainer
      center={[13.05, 80.22]}
      zoom={11}
      minZoom={9}
      preferCanvas
      scrollWheelZoom
      // On a phone a one-finger drag should scroll the page; two fingers move the map.
      dragging={!touchOnly}
      className="h-full w-full"
      zoomControl={false}
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      {trafficOverlay ? (
        <TileLayer
          url="/api/traffic-tile/{z}/{x}/{y}"
          attribution="Traffic &copy; TomTom"
          opacity={0.75}
          maxZoom={19}
          maxNativeZoom={18}
          zIndex={5}
          // Tiles older than a minute are stale, so let the browser refetch them when panned back to.
          updateWhenIdle
          keepBuffer={1}
        />
      ) : null}
      <Camera
        junctions={junctions}
        selectedId={selectedId}
        routes={routes}
        routeIndex={routeIndex}
      />
      <ClickToPick pick={pick} onPick={onPick} />
      <KeyboardNav junctions={junctions} selectedId={selectedId} onSelect={handleSelect} />
      <ZoomButtons />

      {/* Alternatives first so the chosen route draws on top. */}
      {routes.map((assessment, index) =>
        index === routeIndex ? null : (
          <Polyline
            key={`alt-${assessment.id}`}
            positions={assessment.route.coordinates.map(([lng, lat]) => [lat, lng])}
            pathOptions={{ color: ALT_COLOR, weight: 5, opacity: 0.7, bubblingMouseEvents: false }}
            eventHandlers={{ click: () => onChooseRoute(index) }}
          />
        ),
      )}
      {active ? (
        <>
          <Polyline
            positions={active.route.coordinates.map(([lng, lat]) => [lat, lng])}
            pathOptions={ROUTE_CASING}
            interactive={false}
          />
          <Polyline
            positions={active.route.coordinates.map(([lng, lat]) => [lat, lng])}
            pathOptions={{
              color: ROUTE_COLOR,
              weight: 6,
              opacity: 1,
              ...(active.estimate ? { dashArray: "2 10" } : {}),
              bubblingMouseEvents: false,
            }}
            interactive={false}
          />
        </>
      ) : null}

      <FitRun run={run} />
      {run ? <PriorityLayer run={run} /> : null}
      <FlagLayer overrides={overrides} incidents={incidents} />

      {junctions.map((junction) => {
        const selected = junction.junction_id === selectedId;
        const crossed = onRoute.has(junction.junction_id);
        return (
          <JunctionMarker
            key={junction.junction_id}
            id={junction.junction_id}
            lat={junction.latitude}
            lng={junction.longitude}
            name={junction.name}
            zone={junction.zone}
            level={junction.congestion_level}
            avg={junction.avg_vehicle_count}
            selected={selected}
            crossed={crossed}
            dim={active && !crossed && !selected ? 0.35 : 1}
            onSelect={handleSelect}
          />
        );
      })}

      {from ? <Pin point={from} color="#4ade80" /> : null}
      {to ? <Pin point={to} color="#f472b6" /> : null}
    </MapContainer>
  );
}

function Pin({ point, color }: { point: Endpoint; color: string }) {
  const center = useMemo<[number, number]>(() => [point.lat, point.lng], [point.lat, point.lng]);
  return (
    <CircleMarker
      center={center}
      radius={9}
      pathOptions={{
        color: "#ffffff",
        fillColor: color,
        fillOpacity: 1,
        weight: 3,
        bubblingMouseEvents: false,
      }}
    >
      <Tooltip permanent direction="top" offset={[0, -10]} opacity={1}>
        {point.label}
      </Tooltip>
    </CircleMarker>
  );
}
