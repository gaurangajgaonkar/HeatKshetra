export const API_BASE_URL = (
  (import.meta.env["VITE_HEAT_RISK_API_URL"] as string | undefined) || "http://127.0.0.1:8000"
)
  .replace(/\/wards\/geojson\/?$/, "")
  .replace(/\/$/, "");

export type RiskLevel = "Low" | "Moderate" | "High" | "Very High" | "Extreme";
export type HeatRiskProperties = {
  ward_id?: string;
  ward_name?: string;
  name: string;
  score: number;
  risk_level?: RiskLevel;
  alert_level?: "GREEN" | "YELLOW" | "ORANGE" | "RED";
  risk_category?: string;
  mri?: number;
  temperature_c?: number;
  humidity_pct?: number;
  wind_speed_ms?: number;
  solar_wm2?: number;
  heat_index_c?: number;
  simplified_wbgt_c?: number;
  vulnerability_index?: number;
  elderly_pct?: number;
  outdoor_worker_pct?: number;
  informal_housing_pct?: number;
  comorbidity_proxy?: number;
  is_placeholder?: boolean;
  is_simulated?: boolean;
  is_current?: boolean;
  observed_at?: string;
  is_stale?: boolean;
  data_source?: string;
  population?: number;
  population_2011?: number;
  population_source_year?: number;
  population_estimate_year?: number;
  population_is_projected?: boolean;
  population_confidence?: string;
  population_source?: string;
  expected_excess_deaths?: number | null;
};

export type HeatRiskGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };
export type HeatRiskFeature = {
  type: "Feature";
  id?: string;
  properties: HeatRiskProperties;
  geometry: HeatRiskGeometry;
};
export type HeatRiskCollection = {
  type: "FeatureCollection";
  features: HeatRiskFeature[];
  data_source?: string;
  is_simulated?: boolean;
  target_date?: string;
  updated_at?: string | null;
  is_current?: boolean;
  is_stale?: boolean;
  error?: string | null;
  connection_status?: "backend" | "fallback" | "offline";
};

export type CityForecast = {
  target_date: string;
  lead_days: number;
  max_temperature_c: number;
  max_heat_index_c: number;
  risk_level: "GREEN" | "YELLOW" | "ORANGE" | "RED";
  map_risk_level: RiskLevel;
  score: number;
  highest_ward_id: string;
  highest_ward_name: string;
  ward_count: number;
  risk_counts: Record<"GREEN" | "YELLOW" | "ORANGE" | "RED", number>;
  top_wards: HeatRiskProperties[];
};

export type WardSummary = {
  ward_id: string;
  ward_name: string;
  elderly_pct: number;
  outdoor_worker_pct: number;
  informal_housing_pct: number;
  comorbidity_proxy: number;
  is_placeholder: boolean;
  source: string;
  population?: number | null;
  population_2011?: number | null;
  population_source_year?: number | null;
  population_estimate_year?: number | null;
  population_is_projected?: boolean;
  population_confidence?: string | null;
  population_source?: string | null;
};

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof data?.detail === "string" ? data.detail : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return data as T;
}

export function getHeatRisk(day: number) {
  return apiRequest<HeatRiskCollection>(`/wards/geojson?day=${day}`);
}

export function getCityForecast() {
  return apiRequest<{ data_source: string; is_simulated: boolean; forecasts: CityForecast[] }>(
    "/forecast/city?days=5",
  );
}

export function getWards() {
  return apiRequest<WardSummary[]>("/wards");
}

export function getAdvisory(level: string) {
  return apiRequest<{ title: string; text: string; actions: string[]; risk_level: string }>(
    `/advisories/${encodeURIComponent(level)}`,
  );
}

export function getActionPlan(level: string) {
  return apiRequest<{ actions: string[]; risk_level: string }>(
    `/action-plan/${encodeURIComponent(level)}`,
  );
}

export function subscribeToAlerts(payload: {
  phone: string;
  channel: "SMS" | "WHATSAPP";
  ward_id: string;
  language: string;
  consent: boolean;
}) {
  return apiRequest<{ status: string; ward_id: string; channel: string }>("/subscribe", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function triggerLiveAlert(riskLevel: string, adminKey: string) {
  return apiRequest<{
    delivery_mode: "live";
    eligible_wards: number;
    recipient_count: number;
    groups: Array<{ ward_id: string; channel: string; recipients: number; status: string }>;
    message: string;
  }>("/alerts/trigger", {
    method: "POST",
    headers: { "X-Admin-Key": adminKey },
    body: JSON.stringify({ risk_level: riskLevel }),
  });
}

export function sendExtremeRiskDemoSms(phone: string, adminKey: string) {
  return apiRequest<{
    status: "SENT";
    risk_level: "RED";
    channel: "SMS";
    ward_id: string;
    recipients: 1;
    message: string;
  }>("/alerts/demo-sms", {
    method: "POST",
    headers: { "X-Admin-Key": adminKey },
    body: JSON.stringify({ phone }),
  });
}

export function subscribeBrowserForPush(token: string, wardId: string) {
  return apiRequest<{ status: string; subscription_id: number; ward_id: string }>("/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ token, ward_id: wardId, consent: true }),
  });
}

export function sendExtremeRiskDemoPush(subscriptionId: number, adminKey: string) {
  return apiRequest<{
    status: "ACCEPTED";
    risk_level: "RED";
    channel: "PUSH";
    ward_id: string;
    recipients: 1;
    message: string;
  }>("/alerts/demo-push", {
    method: "POST",
    headers: { "X-Admin-Key": adminKey },
    body: JSON.stringify({ subscription_id: subscriptionId }),
  });
}

export function getAlertLog() {
  return apiRequest<{
    items: Array<{
      id: number;
      ward_id: string | null;
      risk_level: string;
      channel: string;
      recipients: number;
      sent_at: string;
      status: string;
    }>;
  }>("/alerts/log?limit=10");
}

export function getWardMri(
  wardId: string,
  temperatureC: number,
  humidityPct: number,
  windSpeedMs: number,
) {
  const params = new URLSearchParams({
    temperature_c: String(temperatureC),
    humidity_pct: String(humidityPct),
    wind_speed_ms: String(windSpeedMs),
  });
  return apiRequest<{
    ward_id: string;
    ward_name: string;
    risk_index: number;
    relative_risk: number;
    vulnerability_index: number;
    risk_category: string;
    alert_level: string;
    heat_index_c: number;
    simplified_wbgt_c: number;
  }>(`/ward/${encodeURIComponent(wardId)}/mri?${params}`);
}
