import { memo, useEffect, useMemo } from "react";
import { CircleMarker, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import type { OperatorOverride, PriorityRunStatus, RoadIncident } from "@/lib/sim-engine";

/** Canvas paths cannot read CSS variables, so these mirror the signal tokens as hex. */
const AMBULANCE = "#fb4d6a";
const WAVE = "#22d3ee";
const GO = "#4ade80";
const HOLD = "#fbbf24";

const POSITION = new Map(SEED_JUNCTIONS.map((j) => [j.id, [j.lat, j.lng] as [number, number]]));

const vehicleIcon = (kind: "ambulance" | "wave") =>
  L.divIcon({
    className: `run-vehicle run-${kind}`,
    html: "<span></span>",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
const AMBULANCE_ICON = vehicleIcon("ambulance");
const WAVE_ICON = vehicleIcon("wave");

const flagIcon = (kind: "accident" | "works") =>
  L.divIcon({
    className: `incident-flag incident-${kind}`,
    html: `<span>${kind === "accident" ? "!" : "⚒"}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 30],
  });
const ACCIDENT_ICON = flagIcon("accident");
const WORKS_ICON = flagIcon("works");

/** Bring the whole route into view when a run starts. */
export function FitRun({ run }: { run: PriorityRunStatus | null }) {
  const map = useMap();
  const coordinates = run?.coordinates;
  useEffect(() => {
    if (!coordinates || coordinates.length < 2) return;
    const bounds = L.latLngBounds(coordinates.map(([lng, lat]) => [lat, lng] as [number, number]));
    map.fitBounds(bounds, { padding: [70, 70], maxZoom: 14, animate: true });
  }, [coordinates, map]);
  return null;
}

/** The route of an ambulance or green wave, the vehicle on it, and the signals clearing for it. */
export const PriorityLayer = memo(function PriorityLayer({ run }: { run: PriorityRunStatus }) {
  const color = run.kind === "ambulance" ? AMBULANCE : WAVE;
  const line = useMemo(
    () => run.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    [run.coordinates],
  );
  const position: [number, number] = [run.position[1], run.position[0]];

  return (
    <>
      <Polyline
        positions={line}
        pathOptions={{ color: "#0b1030", weight: 11, opacity: 0.85, bubblingMouseEvents: false }}
        interactive={false}
      />
      <Polyline
        positions={line}
        pathOptions={{
          color,
          weight: 6,
          opacity: 0.95,
          dashArray: run.kind === "wave" ? "1 10" : undefined,
          lineCap: "round",
          bubblingMouseEvents: false,
        }}
        interactive={false}
      />
      {run.stops.map((stop) => {
        const at = POSITION.get(stop.junctionId);
        if (!at || stop.phase === "ahead") return null;
        return (
          <CircleMarker
            key={`${stop.junctionId}-${stop.alongM}`}
            center={at}
            radius={stop.phase === "clearing" ? 20 : 12}
            pathOptions={{
              color: stop.phase === "clearing" ? GO : color,
              weight: stop.phase === "clearing" ? 4 : 2,
              opacity: stop.phase === "clearing" ? 1 : 0.5,
              fillColor: GO,
              fillOpacity: stop.phase === "clearing" ? 0.22 : 0,
              bubblingMouseEvents: false,
            }}
            interactive={false}
          />
        );
      })}
      {!run.finished ? (
        <Marker
          position={position}
          icon={run.kind === "ambulance" ? AMBULANCE_ICON : WAVE_ICON}
          interactive={false}
          keyboard={false}
          zIndexOffset={1000}
        />
      ) : null}
    </>
  );
});

/** Marks where an operator holds a green and where a problem has been reported. */
export const FlagLayer = memo(function FlagLayer({
  overrides,
  incidents,
}: {
  overrides: OperatorOverride[];
  incidents: RoadIncident[];
}) {
  return (
    <>
      {overrides.map((o) => {
        const at = POSITION.get(o.junctionId);
        return at ? (
          <CircleMarker
            key={`hold-${o.junctionId}`}
            center={at}
            radius={17}
            pathOptions={{
              color: HOLD,
              weight: 3,
              dashArray: "5 5",
              fillOpacity: 0,
              bubblingMouseEvents: false,
            }}
            interactive={false}
          />
        ) : null;
      })}
      {incidents.map((incident) => {
        const junctionId = SEED_JUNCTIONS[Math.floor((incident.roadId - 1) / 4)]?.id;
        const at = junctionId === undefined ? undefined : POSITION.get(junctionId);
        return at ? (
          <Marker
            key={`inc-${incident.roadId}`}
            position={at}
            icon={incident.kind === "accident" ? ACCIDENT_ICON : WORKS_ICON}
            keyboard={false}
          >
            <Tooltip direction="top" offset={[0, -26]} opacity={1}>
              {incident.kind === "accident" ? "Accident reported" : "Road works reported"}
            </Tooltip>
          </Marker>
        ) : null;
      })}
    </>
  );
});
