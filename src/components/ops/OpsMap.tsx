import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { RouteAssessment } from "@/lib/routing";
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
  /** When set, the next click on empty map picks that endpoint. */
  pick: "from" | "to" | null;
  onPick: (which: "from" | "to", point: { lat: number; lng: number }) => void;
  onChooseRoute: (index: number) => void;
};

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

  useEffect(() => {
    if (framed.current || junctions.length === 0) return;
    framed.current = true;
    map.fitBounds(L.latLngBounds(junctions.map((j) => [j.latitude, j.longitude])), {
      padding: [48, 48],
    });
  }, [junctions, map]);

  const routeKey = routes.map((r) => r.route.distanceM.toFixed(0)).join("|");
  useEffect(() => {
    const chosen = routes[routeIndex] ?? routes[0];
    if (!chosen || chosen.route.coordinates.length < 2) return;
    map.fitBounds(
      L.latLngBounds(chosen.route.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])),
      { padding: [72, 72], maxZoom: 15 },
    );
    // Only refit when the set of routes changes, not when the user flips between them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, map]);

  useEffect(() => {
    if (selectedId === null || selectedId === lastSelected.current) return;
    lastSelected.current = selectedId;
    const j = junctions.find((item) => item.junction_id === selectedId);
    if (!j || routes.length > 0) return;
    map.flyTo([j.latitude, j.longitude], Math.max(map.getZoom(), 13), { duration: 0.8 });
  }, [selectedId, junctions, routes.length, map]);

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
}: Props) {
  const active = routes[routeIndex] ?? null;
  const onRoute = new Set(active?.junctions.map((j) => j.junctionId));

  return (
    <MapContainer
      center={[13.05, 80.22]}
      zoom={11}
      minZoom={9}
      preferCanvas
      scrollWheelZoom
      className="h-full w-full"
      zoomControl={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
        maxZoom={19}
      />
      <Camera
        junctions={junctions}
        selectedId={selectedId}
        routes={routes}
        routeIndex={routeIndex}
      />
      <ClickToPick pick={pick} onPick={onPick} />

      {/* Alternatives first so the chosen route draws on top. */}
      {routes.map((assessment, index) =>
        index === routeIndex ? null : (
          <Polyline
            key={`alt-${index}`}
            positions={assessment.route.coordinates.map(([lng, lat]) => [lat, lng])}
            pathOptions={{ color: ALT_COLOR, weight: 5, opacity: 0.7 }}
            eventHandlers={{ click: () => onChooseRoute(index) }}
          />
        ),
      )}
      {active ? (
        <>
          <Polyline
            positions={active.route.coordinates.map(([lng, lat]) => [lat, lng])}
            pathOptions={{ color: "#0b1030", weight: 10, opacity: 0.9 }}
          />
          <Polyline
            positions={active.route.coordinates.map(([lng, lat]) => [lat, lng])}
            pathOptions={{
              color: ROUTE_COLOR,
              weight: 6,
              opacity: 1,
              dashArray: active.estimate ? "2 10" : undefined,
            }}
          />
        </>
      ) : null}

      {junctions.map((junction) => {
        const color = LEVEL_COLOR[junction.congestion_level] ?? LEVEL_COLOR["LOW"];
        const selected = junction.junction_id === selectedId;
        const crossed = onRoute.has(junction.junction_id);
        const dim = active && !crossed && !selected ? 0.35 : 1;
        const base = 5 + Math.min(1, junction.avg_vehicle_count / 70) * 4;
        return (
          <CircleMarker
            key={junction.junction_id}
            center={[junction.latitude, junction.longitude]}
            radius={selected ? base + 4 : crossed ? base + 2 : base}
            pathOptions={{
              color: selected || crossed ? "#ffffff" : color,
              fillColor: color,
              fillOpacity: 0.85 * dim,
              opacity: dim,
              weight: selected ? 3 : crossed ? 2.5 : 1.5,
            }}
            eventHandlers={{ click: () => onSelect(junction.junction_id) }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={1}>
              <span className="font-medium">{junction.name}</span>
              <br />
              {junction.zone} · {junction.congestion_level.toLowerCase()} · avg{" "}
              {junction.avg_vehicle_count} vehicles
            </Tooltip>
          </CircleMarker>
        );
      })}

      {from ? <Pin point={from} color="#4ade80" /> : null}
      {to ? <Pin point={to} color="#f472b6" /> : null}
    </MapContainer>
  );
}

function Pin({ point, color }: { point: Endpoint; color: string }) {
  return (
    <CircleMarker
      center={[point.lat, point.lng]}
      radius={9}
      pathOptions={{ color: "#ffffff", fillColor: color, fillOpacity: 1, weight: 3 }}
    >
      <Tooltip permanent direction="top" offset={[0, -10]} opacity={1}>
        {point.label}
      </Tooltip>
    </CircleMarker>
  );
}
