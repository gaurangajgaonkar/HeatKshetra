import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import {
  GeoJSON,
  MapContainer,
  Marker,
  ScaleControl,
  TileLayer,
  useMap,
} from "react-leaflet";
import { riskLevel, riskToken, type HeatRiskCollection } from "@/lib/heat-risk";
import type { RiskLevel } from "@/lib/heat-risk";
import type { HeatRiskProperties } from "@/lib/api";

export type MapHandle = { zoomIn: () => void; zoomOut: () => void };

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "orange";
}

function createPinIcon(risk?: RiskLevel) {
  const color = risk ? cssVar(riskToken[risk]) : cssVar("--info");
  return L.divIcon({
    className: "leaflet-location-pin",
    html: `<div class="location-pin" style="--risk-color:${color}"><span><svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span><i></i></div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

function Controller({
  center,
  zoom,
  onReady,
}: {
  center: [number, number];
  zoom: number;
  onReady: (h: MapHandle) => void;
}) {
  const map = useMap();
  useEffect(() => {
    onReady({ zoomIn: () => map.zoomIn(), zoomOut: () => map.zoomOut() });
  }, [map, onReady]);
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 0.8 });
  }, [map, center, zoom]);
  return null;
}

export default function HeatMap({
  center,
  data,
  showHeat,
  zoom,
  onReady,
  onWardSelect,
  selectedWardId,
  markerRisk,
}: {
  center: [number, number];
  data: HeatRiskCollection;
  showHeat: boolean;
  zoom: number;
  onReady: (h: MapHandle) => void;
  onWardSelect: (ward: HeatRiskProperties) => void;
  selectedWardId: string | undefined;
  markerRisk?: RiskLevel;
}) {
  const locationIcon = useMemo(() => createPinIcon(markerRisk), [markerRisk]);
  const key = useMemo(
    () =>
      JSON.stringify([
        data.target_date,
        selectedWardId,
        data.features.map((f) => [f.id, f.properties.score]),
      ]),
    [data, selectedWardId],
  );
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      zoomControl={false}
      attributionControl
      className="leaflet-heat-map"
      minZoom={4}
      maxZoom={18}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      {showHeat && (
        <GeoJSON
          key={key}
          data={data as never}
          style={(f) => {
            const color = cssVar(riskToken[riskLevel(f?.properties?.score ?? 0)]);
            const selected = f?.properties?.ward_id === selectedWardId;
            return {
              color,
              weight: selected ? 2.5 : 1,
              opacity: selected ? 0.95 : 0.6,
              fillColor: color,
              fillOpacity: selected ? 0.68 : 0.5,
              className: "heat-zone-path",
            };
          }}
          onEachFeature={(f, layer) => {
            const properties = f.properties as HeatRiskProperties;
            layer.on("click", () => onWardSelect(properties));
          }}
        />
      )}
      <Marker position={center} icon={locationIcon} />
      <ScaleControl position="bottomleft" imperial={false} />
      <Controller center={center} zoom={zoom} onReady={onReady} />
    </MapContainer>
  );
}
