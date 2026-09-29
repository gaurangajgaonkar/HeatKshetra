import {
  getHeatRisk,
  type HeatRiskCollection,
  type HeatRiskFeature,
  type HeatRiskProperties,
} from "@/lib/api";

export type { HeatRiskCollection, HeatRiskFeature, HeatRiskProperties } from "@/lib/api";
export type RiskLevel = "Low" | "Moderate" | "High" | "Very High" | "Extreme";

export function riskLevel(score: number): RiskLevel {
  if (score <= 20) return "Low";
  if (score <= 40) return "Moderate";
  if (score <= 60) return "High";
  if (score <= 80) return "Very High";
  return "Extreme";
}

export const riskToken: Record<RiskLevel, string> = {
  Low: "--heat-low",
  Moderate: "--heat-moderate",
  High: "--heat-high",
  "Very High": "--heat-very-high",
  Extreme: "--heat-extreme",
};

export function emptyHeatRisk(error?: string): HeatRiskCollection {
  return {
    type: "FeatureCollection",
    features: [],
    data_source: "WEATHER_UNAVAILABLE",
    is_simulated: false,
    connection_status: "offline",
    error,
  };
}

export async function fetchHeatRisk(day: number): Promise<HeatRiskCollection> {
  try {
    const data = await getHeatRisk(day);
    if (!Array.isArray(data.features) || !data.features.length) {
      throw new Error(data.error || "Live weather is not available yet.");
    }
    return { ...data, connection_status: "backend" };
  } catch (error) {
    return emptyHeatRisk(error instanceof Error ? error.message : "Live weather is unavailable.");
  }
}

export function pointInRing(lng: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function containsPoint(feature: HeatRiskFeature, lng: number, lat: number): boolean {
  if (feature.geometry.type === "Polygon")
    return pointInRing(lng, lat, feature.geometry.coordinates[0] ?? []);
  return feature.geometry.coordinates.some((polygon) => pointInRing(lng, lat, polygon[0] ?? []));
}

export function scoreAt(data: HeatRiskCollection, lat: number, lng: number): number | null {
  return featureAt(data, lat, lng)?.score ?? null;
}

export function featureAt(
  data: HeatRiskCollection,
  lat: number,
  lng: number,
): HeatRiskProperties | null {
  return data.features.find((feature) => containsPoint(feature, lng, lat))?.properties ?? null;
}
