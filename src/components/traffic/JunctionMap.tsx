import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { JunctionSummary } from "@/lib/traffic-data";

const LEVEL_COLOR: Record<string, string> = {
  LOW: "var(--signal-low)",
  MODERATE: "var(--signal-moderate)",
  HIGH: "var(--signal-high)",
};

type Props = {
  junctions: JunctionSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
};

/** Fit the view to the whole monitored network once data arrives. */
function FitToNetwork({ junctions }: { junctions: JunctionSummary[] }) {
  const map = useMap();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done || junctions.length === 0) return;
    const bounds = L.latLngBounds(junctions.map((j) => [j.latitude, j.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [32, 32] });
    setDone(true);
  }, [junctions, map, done]);
  return null;
}

function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  useMapEvents({ zoomend: (event) => onZoom(event.target.getZoom()) });
  return null;
}

export default function JunctionMap({ junctions, selectedId, onSelect }: Props) {
  const [zoom, setZoom] = useState(11);

  return (
    <MapContainer
      center={[13.05, 80.22]}
      zoom={11}
      minZoom={9}
      preferCanvas
      scrollWheelZoom
      className="h-full w-full"
      attributionControl
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      <FitToNetwork junctions={junctions} />
      <ZoomWatcher onZoom={setZoom} />
      {junctions.map((junction) => {
        const color = LEVEL_COLOR[junction.congestion_level] ?? LEVEL_COLOR['LOW'];
        const selected = junction.junction_id === selectedId;
        // Volume drives size, zoom keeps dense corridors readable.
        const load = Math.min(1, junction.avg_vehicle_count / 80);
        const base = 4 + load * 5 + Math.max(0, zoom - 11) * 1.4;
        return (
          <CircleMarker
            key={junction.junction_id}
            center={[junction.latitude, junction.longitude]}
            radius={selected ? base + 5 : base}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: selected ? 0.6 : 0.32,
              weight: selected ? 3 : 1.5,
            }}
            eventHandlers={{ click: () => onSelect(junction.junction_id) }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={1}>
              <span className="font-medium">{junction.name}</span>
              <br />
              {junction.zone} · {junction.congestion_level} · avg {junction.avg_vehicle_count} veh
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
