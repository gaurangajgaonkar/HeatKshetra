// Heat-risk data contract for the GIS map.
// Backend can supply a GeoJSON FeatureCollection whose features carry
// `properties.score` (0–100) and optional `properties.name`.
// Set VITE_HEAT_RISK_API_URL to your existing backend endpoint; `?day=<index>` is appended.
// Mock data below is only a temporary fallback.

export type HeatRiskProperties = { name: string; score: number };
export type HeatRiskFeature = {
  type: "Feature";
  properties: HeatRiskProperties;
  geometry: { type: "Polygon"; coordinates: number[][][] };
};
export type HeatRiskCollection = { type: "FeatureCollection"; features: HeatRiskFeature[] };

export type RiskLevel = "Low" | "Moderate" | "High" | "Very High" | "Extreme";

export function riskLevel(score: number): RiskLevel {
  if (score <= 20) return "Low";
  if (score <= 40) return "Moderate";
  if (score <= 60) return "High";
  if (score <= 80) return "Very High";
  return "Extreme";
}

// Tokens are resolved from CSS custom properties at render time.
export const riskToken: Record<RiskLevel, string> = {
  Low: "--heat-low",
  Moderate: "--heat-moderate",
  High: "--heat-high",
  "Very High": "--heat-very-high",
  Extreme: "--heat-extreme",
};

// Polygons as [lng, lat] (GeoJSON order), approximating real MMR areas.
const zones: { name: string; base: number; ring: [number, number][] }[] = [
  { name: "South Mumbai", base: 58, ring: [[72.806, 18.905], [72.838, 18.9], [72.858, 18.955], [72.846, 19.005], [72.815, 19.0], [72.806, 18.905]] },
  { name: "Dadar–Worli", base: 66, ring: [[72.815, 19.0], [72.846, 19.005], [72.862, 19.03], [72.845, 19.055], [72.822, 19.045], [72.815, 19.0]] },
  { name: "Bandra–Santacruz", base: 70, ring: [[72.822, 19.045], [72.845, 19.055], [72.862, 19.07], [72.86, 19.1], [72.832, 19.1], [72.822, 19.045]] },
  { name: "Dharavi–Kurla", base: 82, ring: [[72.845, 19.03], [72.895, 19.03], [72.9, 19.085], [72.862, 19.085], [72.845, 19.055], [72.845, 19.03]] },
  { name: "Andheri–Goregaon", base: 74, ring: [[72.832, 19.1], [72.87, 19.1], [72.87, 19.175], [72.838, 19.175], [72.832, 19.1]] },
  { name: "Malad–Borivali", base: 61, ring: [[72.838, 19.175], [72.87, 19.175], [72.875, 19.26], [72.845, 19.26], [72.838, 19.175]] },
  { name: "Ghatkopar–Mulund", base: 72, ring: [[72.9, 19.07], [72.94, 19.07], [72.965, 19.17], [72.93, 19.18], [72.9, 19.12], [72.9, 19.07]] },
  { name: "Chembur–Mankhurd", base: 76, ring: [[72.895, 19.03], [72.94, 19.03], [72.94, 19.07], [72.9, 19.07], [72.895, 19.03]] },
  { name: "Thane", base: 68, ring: [[72.94, 19.17], [72.99, 19.17], [73.02, 19.24], [72.97, 19.27], [72.945, 19.22], [72.94, 19.17]] },
  { name: "Mira–Bhayandar", base: 48, ring: [[72.845, 19.26], [72.89, 19.26], [72.895, 19.32], [72.85, 19.32], [72.845, 19.26]] },
  { name: "Vashi–Airoli", base: 56, ring: [[72.99, 19.06], [73.03, 19.06], [73.03, 19.16], [73.0, 19.17], [72.99, 19.06]] },
  { name: "Nerul–Belapur", base: 44, ring: [[73.0, 18.99], [73.06, 18.99], [73.06, 19.06], [73.01, 19.06], [73.0, 18.99]] },
  { name: "Panvel", base: 34, ring: [[73.06, 18.96], [73.14, 18.96], [73.14, 19.03], [73.06, 19.03], [73.06, 18.96]] },
];

const dayShift = [0, 7, 12, 4, -14];

export function mockHeatRisk(day: number): HeatRiskCollection {
  const shift = dayShift[day] ?? 0;
  return {
    type: "FeatureCollection",
    features: zones.map((z) => ({
      type: "Feature",
      properties: { name: z.name, score: Math.max(0, Math.min(100, z.base + shift)) },
      geometry: { type: "Polygon", coordinates: [z.ring] },
    })),
  };
}

export async function fetchHeatRisk(day: number): Promise<HeatRiskCollection> {
  const url = import.meta.env["VITE_HEAT_RISK_API_URL"] as string | undefined;
  if (!url) return mockHeatRisk(day);
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}day=${day}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as HeatRiskCollection;
    return data?.features?.length ? data : mockHeatRisk(day);
  } catch {
    return mockHeatRisk(day);
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

export function scoreAt(data: HeatRiskCollection, lat: number, lng: number): number | null {
  const f = data.features.find((f) => pointInRing(lng, lat, f.geometry.coordinates[0] ?? []));
  return f ? f.properties.score : null;
}
