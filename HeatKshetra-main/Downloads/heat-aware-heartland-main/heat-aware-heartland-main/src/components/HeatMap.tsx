import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { GeoJSON, MapContainer, Marker, ScaleControl, TileLayer, Tooltip, useMap } from "react-leaflet";
import { riskLevel, riskToken, type HeatRiskCollection } from "@/lib/heat-risk";

export type MapHandle = { zoomIn: () => void; zoomOut: () => void };

const pinIcon = L.divIcon({
  className: "leaflet-location-pin",
  html: '<div class="location-pin"><span><svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span><i></i></div>',
  iconSize: [48, 48],
  iconAnchor: [24, 24],
});

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "orange";
}

function Controller({ center, onReady }: { center: [number, number]; onReady: (h: MapHandle) => void }) {
  const map = useMap();
  useEffect(() => { onReady({ zoomIn: () => map.zoomIn(), zoomOut: () => map.zoomOut() }); }, [map, onReady]);
  useEffect(() => { map.flyTo(center, Math.max(map.getZoom(), 12), { duration: 0.8 }); }, [map, center]);
  return null;
}

export default function HeatMap({ center, data, showHeat, label, onReady }: {
  center: [number, number]; data: HeatRiskCollection; showHeat: boolean; label: string; onReady: (h: MapHandle) => void;
}) {
  const key = useMemo(() => JSON.stringify(data.features.map((f) => f.properties.score)), [data]);
  return (
    <MapContainer center={center} zoom={11} zoomControl={false} attributionControl className="leaflet-heat-map" minZoom={4} maxZoom={18}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
      {showHeat && (
        <GeoJSON
          key={key}
          data={data as never}
          style={(f) => {
            const color = cssVar(riskToken[riskLevel(f?.properties?.score ?? 0)]);
            return { color, weight: 1, opacity: 0.6, fillColor: color, fillOpacity: 0.5, className: "heat-zone-path" };
          }}
          onEachFeature={(f, layer) => layer.bindTooltip(`${f.properties.name}: ${f.properties.score}/100 · ${riskLevel(f.properties.score)}`, { sticky: true })}
        />
      )}
      <Marker position={center} icon={pinIcon}><Tooltip direction="top" offset={[0, -22]}>{label}</Tooltip></Marker>
      <ScaleControl position="bottomleft" imperial={false} />
      <Controller center={center} onReady={onReady} />
    </MapContainer>
  );
}
