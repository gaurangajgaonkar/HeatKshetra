import { createFileRoute } from "@tanstack/react-router";
import {
  Accessibility,
  Activity,
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  BellRing,
  Check,
  ChevronDown,
  Crosshair,
  Droplets,
  HeartPulse,
  Layers3,
  MapPin,
  Menu,
  MessageSquareText,
  Minus,
  Navigation,
  PersonStanding,
  Plus,
  ShieldAlert,
  Sun,
  ThermometerSun,
  Wind,
  X,
  Zap,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import mumbaiMap from "@/assets/mumbai-gis-base.jpg";
import type { MapHandle } from "@/components/HeatMap";
import { emptyHeatRisk, featureAt, fetchHeatRisk, riskToken, type HeatRiskCollection } from "@/lib/heat-risk";
import {
  getActionPlan,
  getAdvisory,
  getAlertLog,
  getCityForecast,
  getWardMri,
  getWards,
  sendExtremeRiskDemoSms,
  sendExtremeRiskDemoPush,
  subscribeToAlerts,
  triggerLiveAlert,
  subscribeBrowserForPush,
  type CityForecast,
  type HeatRiskProperties,
  type WardSummary,
} from "@/lib/api";
import { isFirebasePushConfigured, requestBrowserPushToken } from "@/lib/firebase-messaging";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HeatKshetra — Mumbai Human Heat-Risk Dashboard" },
      {
        name: "description",
        content:
          "Monitor Mumbai heatwave intensity, human heat stress, and location-based safety guidance on a GIS dashboard.",
      },
      { property: "og:title", content: "HeatKshetra — Human Heat-Risk Dashboard" },
      {
        property: "og:description",
        content:
          "Weather data, GIS intelligence, and actionable human heat-risk guidance for Mumbai.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HeatKshetraDashboard,
});

const HeatMap = lazy(() => import("@/components/HeatMap"));

type RiskPreviewMode = "low" | "high" | "extreme";

function riskPreviewFromUrl(): RiskPreviewMode | null {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get("risk-preview");
  return value === "low" || value === "high" || value === "extreme" ? value : null;
}

function withRiskPreview(data: HeatRiskCollection, mode: RiskPreviewMode, day: number): HeatRiskCollection {
  const scenario = ({
    low: { risk: "Low", alert: "GREEN", score: 14, temperature: 25, humidity: 40, wind: 2, heatIndex: 25, wbgt: 22, mri: 1.15, relativeRisk: 1, vulnerability: 1.15 },
    high: { risk: "High", alert: "ORANGE", score: 54, temperature: 42, humidity: 70, wind: 1, heatIndex: 51, wbgt: 37, mri: 2.05, relativeRisk: 1.6, vulnerability: 1.28 },
    extreme: { risk: "Extreme", alert: "RED", score: 92, temperature: 47, humidity: 82, wind: 0.5, heatIndex: 68, wbgt: 44, mri: 3.25, relativeRisk: 2.8, vulnerability: 1.75 },
  } as const)[mode];
  return {
    ...data,
    data_source: `RISK_PREVIEW_${mode.toUpperCase()}`,
    is_simulated: true,
    is_current: day === 0,
    features: data.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        score: scenario.score,
        risk_level: scenario.risk,
        map_risk_level: scenario.risk,
        alert_level: scenario.alert,
        risk_category: scenario.risk,
        mri: scenario.mri,
        temperature_c: scenario.temperature,
        humidity_pct: scenario.humidity,
        wind_speed_ms: scenario.wind,
        heat_index_c: scenario.heatIndex,
        simplified_wbgt_c: scenario.wbgt,
        relative_risk: scenario.relativeRisk,
        vulnerability_index: scenario.vulnerability,
        is_current: day === 0,
        is_simulated: true,
        data_source: `RISK_PREVIEW_${mode.toUpperCase()}`,
      },
    })),
  };
}

function withCityRiskPreview(forecasts: CityForecast[], mode: RiskPreviewMode): CityForecast[] {
  const scenario = ({
    low: { risk: "Low", alert: "GREEN", score: 14, temperature: 25, heatIndex: 25 },
    high: { risk: "High", alert: "ORANGE", score: 54, temperature: 42, heatIndex: 51 },
    extreme: { risk: "Extreme", alert: "RED", score: 92, temperature: 47, heatIndex: 68 },
  } as const)[mode];
  return forecasts.map((forecast) => ({
    ...forecast,
    max_temperature_c: scenario.temperature,
    max_heat_index_c: scenario.heatIndex,
    risk_level: scenario.alert,
    map_risk_level: scenario.risk,
    score: scenario.score,
    risk_counts: {
      GREEN: mode === "low" ? forecast.ward_count : 0,
      YELLOW: 0,
      ORANGE: mode === "high" ? forecast.ward_count : 0,
      RED: mode === "extreme" ? forecast.ward_count : 0,
    },
  }));
}

function HeatKshetraDashboard() {
  const [day, setDay] = useState(0);
  const [forecastLabels, setForecastLabels] = useState([
    "Today",
    "Day 2",
    "Day 3",
    "Day 4",
    "Day 5",
  ]);
  const [cityForecast, setCityForecast] = useState<CityForecast[]>([]);
  const [wards, setWards] = useState<WardSummary[]>([]);
  const [selectedWard, setSelectedWard] = useState<HeatRiskProperties | null>(null);
  const [advisory, setAdvisory] = useState<{
    title: string;
    text: string;
    actions: string[];
  } | null>(null);
  const [actionPlan, setActionPlan] = useState<string[]>([]);
  const [alertLogs, setAlertLogs] = useState<
    Array<{
      id: number;
      ward_id: string | null;
      risk_level: string;
      channel: string;
      recipients: number;
      sent_at: string;
      status: string;
    }>
  >([]);
  const [alertResult, setAlertResult] = useState("");
  const [alertAdminKey, setAlertAdminKey] = useState("");
  const [demoSmsPhone, setDemoSmsPhone] = useState("");
  const [demoSmsResult, setDemoSmsResult] = useState("");
  const [pushSubscriptionId, setPushSubscriptionId] = useState<number | null>(null);
  const [pushConsent, setPushConsent] = useState(false);
  const [pushResult, setPushResult] = useState("");
  const [riskPreviewMode, setRiskPreviewMode] = useState<RiskPreviewMode | null>(null);
  const [subscribePhone, setSubscribePhone] = useState("");
  const [subscribeChannel, setSubscribeChannel] = useState<"SMS" | "WHATSAPP">("SMS");
  const [subscribeWardId, setSubscribeWardId] = useState("");
  const [subscribeConsent, setSubscribeConsent] = useState(false);
  const [subscribeResult, setSubscribeResult] = useState("");
  const [mriResult, setMriResult] = useState<Awaited<ReturnType<typeof getWardMri>> | null>(null);
  const [panelError, setPanelError] = useState("");
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [sendingAlert, setSendingAlert] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [sendingDemoPush, setSendingDemoPush] = useState(false);
  const [sendingDemoSms, setSendingDemoSms] = useState(false);
  const [headerTime, setHeaderTime] = useState("Mumbai local time");
  const [layersOpen, setLayersOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showHeat, setShowHeat] = useState(true);
  const [place, setPlace] = useState({ name: "Mumbai (Bandra)", lat: 19.0596, lng: 72.8295 });
  const [mapZoom, setMapZoom] = useState(10);
  const placeRef = useRef(place);
  placeRef.current = place;
  const [heatData, setHeatData] = useState<HeatRiskCollection>(() => emptyHeatRisk());
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const mapRef = useRef<MapHandle | null>(null);
  const onMapReady = useCallback((h: MapHandle) => {
    mapRef.current = h;
  }, []);
  const forecasts = cityForecast.map((item, index) => ({
    short: forecastLabels[index] ?? `Day ${index + 1}`,
    date: forecastLabels[index] ?? `Day ${index + 1}`,
    value: Math.round(item.max_heat_index_c),
    risk: item.map_risk_level,
    score: item.score,
    alertLevel: item.risk_level,
  }));
  const active = forecasts[day] ?? null;
  const activeScore = selectedWard?.score ?? active?.score ?? 0;
  const activeRisk = selectedWard?.risk_level ?? active?.risk ?? null;
  const activeRiskStyle = activeRisk
    ? ({ "--risk-color": `var(${riskToken[activeRisk]})` } as React.CSSProperties)
    : undefined;
  const temperature = selectedWard?.temperature_c;
  const humidity = selectedWard?.humidity_pct;
  const windSpeed = selectedWard?.wind_speed_ms;
  const heatIndex = selectedWard?.heat_index_c ?? active?.value ?? null;
  const currentAlertLevel = selectedWard?.alert_level ?? active?.alertLevel ?? null;
  const weatherTimeLabel = selectedWard?.observed_at
    ? new Intl.DateTimeFormat("en-IN", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }).format(new Date(selectedWard.observed_at))
    : null;
  const dataNote = riskPreviewMode
    ? riskPreviewMode === "extreme"
      ? "FAKE EXTREME-RISK TEST DATA. Risk values stay in this browser and are not stored. The demo controls below can send one clearly labeled SMS or browser push after consent and admin-key checks."
      : `FAKE ${riskPreviewMode.toUpperCase()}-RISK TEST DATA. This preview changes values in this browser only; it does not write to the database or send alerts.`
    : heatData.connection_status === "offline"
      ? heatData.error ??
        "Live weather is unavailable. Check that the backend and internet connection are running."
      : heatData.data_source === "OPEN_METEO"
        ? day === 0
          ? `Current model weather from Open-Meteo${weatherTimeLabel ? ` · updated ${weatherTimeLabel} IST` : ""}. Not a local sensor reading.`
          : `Forecast from Open-Meteo${heatData.is_stale ? " · last weather update is over one hour old" : ""}.`
        : "Simulated demo data is enabled. Set DATA_MODE=live for current weather.";
  const metrics = [
    {
      label: day === 0 && heatData.is_current ? "Current temp" : "Forecast temp",
      value: temperature == null ? "—" : `${temperature.toFixed(1)}°C`,
      icon: ThermometerSun,
    },
    {
      label: "Humidity",
      value: humidity == null ? "—" : `${Math.round(humidity)}%`,
      icon: Droplets,
    },
    {
      label: "Heat Index",
      value: heatIndex == null ? "—" : `${heatIndex.toFixed(1)}°C`,
      icon: Zap,
      emphasis: true,
    },
    {
      label: "Wind Speed",
      value: windSpeed == null ? "—" : `${(windSpeed * 3.6).toFixed(1)} km/h`,
      icon: Wind,
    },
    {
      label: "Solar Radiation",
      value: selectedWard?.solar_wm2 == null ? "—" : `${Math.round(selectedWard.solar_wm2)} W/m²`,
      icon: Sun,
    },
  ];
  const topWards = [...heatData.features]
    .filter((feature) => feature.properties.ward_id)
    .sort((a, b) => b.properties.score - a.properties.score)
    .slice(0, 5);
  const riskCounts = {
    GREEN: heatData.features.filter((feature) => feature.properties.alert_level === "GREEN").length,
    YELLOW: heatData.features.filter((feature) => feature.properties.alert_level === "YELLOW")
      .length,
    ORANGE: heatData.features.filter((feature) => feature.properties.alert_level === "ORANGE")
      .length,
    RED: heatData.features.filter((feature) => feature.properties.alert_level === "RED").length,
  };

  useEffect(() => {
    setMounted(true);
    setRiskPreviewMode(riskPreviewFromUrl());
    const today = new Date();
    setForecastLabels(
      Array.from({ length: 5 }, (_, index) => {
        const date = new Date(today);
        date.setDate(date.getDate() + index);
        return index === 0
          ? "Today"
          : new Intl.DateTimeFormat("en-IN", {
              weekday: "short",
              day: "numeric",
              month: "short",
          }).format(date);
      }),
    );
    const updateHeaderTime = () =>
      setHeaderTime(
        new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date()),
      );
    updateHeaderTime();
    const timer = window.setInterval(updateHeaderTime, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let live = true;
    const refreshCityForecast = () =>
      getCityForecast()
        .then((result) => live && setCityForecast(
          riskPreviewMode ? withCityRiskPreview(result.forecasts, riskPreviewMode) : result.forecasts,
        ))
        .catch(() => live && setCityForecast([]));
    refreshCityForecast();
    const timer = window.setInterval(refreshCityForecast, 5 * 60_000);
    getWards()
      .then((result) => {
        if (!live) return;
        setWards(result);
        if (result[0]) setSubscribeWardId(result[0].ward_id);
      })
      .catch(() => undefined);
    getAlertLog()
      .then((result) => live && setAlertLogs(result.items))
      .catch(() => undefined);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [riskPreviewMode]);
  useEffect(() => {
    let live = true;
    const refreshHeatRisk = () => fetchHeatRisk(day).then((response) => {
      if (!live) return;
      const data = riskPreviewMode ? withRiskPreview(response, riskPreviewMode, day) : response;
      setHeatData(data);
      const location = placeRef.current;
      const locationWard = featureAt(data, location.lat, location.lng);
      setSelectedWard((current) => {
        const currentWard = current?.ward_id
          ? data.features.find(
              (feature) =>
                feature.properties.ward_id && feature.properties.ward_id === current?.ward_id,
            )?.properties
          : null;
        return currentWard ?? locationWard;
      });
    });
    refreshHeatRisk();
    const timer = window.setInterval(refreshHeatRisk, 5 * 60_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [day, riskPreviewMode]);
  useEffect(() => {
    let live = true;
    const level = selectedWard?.alert_level ?? currentAlertLevel;
    if (!level) {
      setAdvisory(null);
      setActionPlan([]);
      return () => {
        live = false;
      };
    }
    getAdvisory(level)
      .then((data) => live && setAdvisory(data))
      .catch(() => live && setAdvisory(null));
    getActionPlan(level)
      .then((data) => live && setActionPlan(data.actions))
      .catch(() => live && setActionPlan([]));
    return () => {
      live = false;
    };
  }, [currentAlertLevel, selectedWard?.alert_level]);

  const calculateMri = async () => {
    if (!selectedWard?.ward_id) {
      setPanelError("Select a backend ward polygon to calculate its MRI.");
      return;
    }
    setPanelError("");
    try {
      const result = await getWardMri(
        selectedWard.ward_id,
        selectedWard.temperature_c ?? 36,
        selectedWard.humidity_pct ?? 60,
        selectedWard.wind_speed_ms ?? 1,
      );
      setMriResult(result);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "MRI request failed.");
    }
  };

  const handleSubscribe = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubscribeResult("");
    setSavingSubscription(true);
    try {
      const result = await subscribeToAlerts({
        phone: subscribePhone,
        channel: subscribeChannel,
        ward_id: subscribeWardId,
        language: "en",
        consent: subscribeConsent,
      });
      setSubscribeResult(`Subscribed for ${result.ward_id} ${result.channel} alerts.`);
      setSubscribePhone("");
      setSubscribeConsent(false);
    } catch (error) {
      setSubscribeResult(error instanceof Error ? error.message : "Subscription failed.");
    } finally {
      setSavingSubscription(false);
    }
  };

  const handleLiveAlert = async () => {
    if (!alertAdminKey.trim()) {
      setAlertResult("Enter the server admin key to authorize live delivery.");
      return;
    }
    setSendingAlert(true);
    setAlertResult("");
    try {
      const result = await triggerLiveAlert("ORANGE", alertAdminKey.trim());
      setAlertResult(
        `${result.message} ${result.recipient_count} message${result.recipient_count === 1 ? "" : "s"} sent across ${result.eligible_wards} eligible wards.`,
      );
      setAlertLogs((await getAlertLog()).items);
    } catch (error) {
      setAlertResult(error instanceof Error ? error.message : "Alert request failed.");
    } finally {
      setAlertAdminKey("");
      setSendingAlert(false);
    }
  };

  const handleEnablePush = async () => {
    if (riskPreviewMode !== "extreme") return;
    if (!pushConsent) {
      setPushResult("Check the consent box before enabling notifications.");
      return;
    }
    const wardId = selectedWard?.ward_id ?? subscribeWardId;
    if (!wardId) {
      setPushResult("Wait for the ward list to load, then enable push again.");
      return;
    }
    setEnablingPush(true);
    setPushResult("");
    try {
      const token = await requestBrowserPushToken();
      const result = await subscribeBrowserForPush(token, wardId);
      setPushSubscriptionId(result.subscription_id);
      setPushResult(`Push notifications enabled for ${result.ward_id} on this browser.`);
    } catch (error) {
      setPushResult(error instanceof Error ? error.message : "Could not enable browser push.");
    } finally {
      setEnablingPush(false);
    }
  };

  const handleExtremeDemoPush = async () => {
    if (riskPreviewMode !== "extreme") return;
    if (!alertAdminKey.trim() || !pushSubscriptionId) {
      setPushResult("Enable push on this browser and enter the server admin key first.");
      return;
    }
    setSendingDemoPush(true);
    setPushResult("");
    try {
      const result = await sendExtremeRiskDemoPush(pushSubscriptionId, alertAdminKey.trim());
      setPushResult(`${result.message} Ward ${result.ward_id}; one browser.`);
      getAlertLog().then((log) => setAlertLogs(log.items)).catch(() => undefined);
    } catch (error) {
      setPushResult(error instanceof Error ? error.message : "Demo push request failed.");
    } finally {
      setAlertAdminKey("");
      setSendingDemoPush(false);
    }
  };

  const handleExtremeDemoSms = async () => {
    if (riskPreviewMode !== "extreme") return;
    if (!alertAdminKey.trim() || !demoSmsPhone.trim()) {
      setDemoSmsResult("Enter the opted-in SMS number and server admin key first.");
      return;
    }
    setSendingDemoSms(true);
    setDemoSmsResult("");
    try {
      const result = await sendExtremeRiskDemoSms(demoSmsPhone.trim(), alertAdminKey.trim());
      setDemoSmsResult(`${result.message} Ward ${result.ward_id}; one SMS recipient.`);
      getAlertLog().then((log) => setAlertLogs(log.items)).catch(() => undefined);
    } catch (error) {
      setDemoSmsResult(error instanceof Error ? error.message : "Demo SMS request failed.");
    } finally {
      setAlertAdminKey("");
      setSendingDemoSms(false);
    }
  };

  const useMyLocation = () => {
    setGeoError(null);
    if (!navigator.geolocation) return setGeoError("Location isn't available in this browser.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const nextPlace = {
          name: "My current location",
          lat: p.coords.latitude,
          lng: p.coords.longitude,
        };
        setPlace(nextPlace);
        setMapZoom(13);
        setSelectedWard(featureAt(heatData, nextPlace.lat, nextPlace.lng));
      },
      () => setGeoError("Couldn't get your location. Please allow location access."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const searchPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setGeoError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`,
      );
      const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      if (!hit) setGeoError("No matching location found.");
      else {
        const nextPlace = {
          name: hit.display_name.split(",").slice(0, 2).join(","),
          lat: +hit.lat,
          lng: +hit.lon,
        };
        setPlace(nextPlace);
        setMapZoom(13);
        setSelectedWard(featureAt(heatData, nextPlace.lat, nextPlace.lng));
      }
    } catch {
      setGeoError("Search failed. Try again.");
    }
    setSearching(false);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="HeatKshetra home">
          <span className="brand-mark">
            <Sun size={21} />
          </span>
          <span>
            <strong>HeatKshetra</strong>
            <small>Heatwave Risk Detection & GIS Dashboard</small>
          </span>
        </a>
        <nav
          className={mobileOpen ? "nav-links nav-open" : "nav-links"}
          aria-label="Main navigation"
        >
          <a href="#top">Home</a>
          <a href="#heatmap">Heatmap</a>
          <a href="#risk-analysis">Risk Analysis</a>
          <a href="#city-actions">Alerts</a>
          <a href="#about">About</a>
        </nav>
        <div className="nav-status">
          <span>
            <MapPin size={14} /> Mumbai, India
          </span>
          <span
            className={`data-status ${riskPreviewMode ? "preview" : heatData.connection_status === "backend" ? "connected" : ""}`}
          >
            <i />{" "}
            {riskPreviewMode
              ? `${riskPreviewMode.toUpperCase()}-RISK TEST`
              : heatData.connection_status === "offline"
              ? "Live weather unavailable"
              : heatData.data_source === "OPEN_METEO"
                ? heatData.is_stale
                  ? "Open-Meteo · stale data"
                  : "Live model weather"
                : "Simulated demo data"}
          </span>
          <time>{headerTime}</time>
          <button
            className="menu-button"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      <section className="dashboard-shell" id="top">
        <section className="risk-panel" aria-labelledby="risk-title">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                <Activity size={13} style={activeRiskStyle} />
                {riskPreviewMode
                  ? `${riskPreviewMode.toUpperCase()}-RISK TEST SCENARIO`
                  : heatData.data_source === "OPEN_METEO"
                  ? day === 0 ? "Current model conditions" : "Weather forecast"
                  : "Waiting for live weather"}
              </span>
              <h1 id="risk-title">{day === 0 ? "Current Heatwave Risk" : "Forecast Heatwave Risk"}</h1>
            </div>
            <span className="updated">{day === 0 ? "Current conditions" : forecasts[day]?.date ?? "Forecast"}</span>
          </div>

          <div className="risk-summary">
            <div
              className="gauge"
              style={{ "--score": `${activeScore * 3.6}deg`, ...(activeRiskStyle ?? {}) } as React.CSSProperties}
            >
              <div>
                <strong>{selectedWard || active ? activeScore : "—"}</strong>
                <span>/100</span>
              </div>
            </div>
            <div className="risk-copy">
              {activeRisk ? (
                <span
                  className={
                    activeRisk === "Moderate" || activeRisk === "Low"
                      ? "risk-badge moderate"
                      : "risk-badge"
                  }
                  style={activeRiskStyle}
                >
                  {activeRisk.toUpperCase()} RISK
                </span>
              ) : (
                <span className="weather-unavailable-label">LIVE WEATHER UNAVAILABLE</span>
              )}
              <p>{advisory?.title ?? (activeRisk ? "Heat risk assessment" : "Risk needs live weather data")}</p>
              <small>
                {advisory?.text ?? "Risk details will appear when live weather is available."}
              </small>
            </div>
          </div>

          <div className="metrics-grid">
            {metrics.map(({ label, value, icon: Icon, emphasis }) => (
              <div className={emphasis ? "metric emphasis" : "metric"} key={label}>
                <span>
                  <Icon size={15} style={activeRiskStyle} /> {label}
                </span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="data-note" role={heatData.connection_status === "offline" ? "alert" : undefined}>
            {dataNote}{" "}
            {heatData.data_source === "OPEN_METEO" && (
              <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                Weather source: Open-Meteo
              </a>
            )}
          </p>

          <div className="advisory" id="alerts">
            <div className="advisory-icon" style={activeRiskStyle}>
              <AlertTriangle size={20} />
            </div>
            <div>
              <strong>{advisory?.title.toUpperCase() ?? "HEALTH ADVISORY"}</strong>
              <p>{advisory?.text ?? "Connect the backend to load the current ward advisory."}</p>
              <small>{advisory?.actions.slice(0, 2).join(" · ")}</small>
            </div>
          </div>

          <button
            className="primary-action"
            type="button"
            onClick={calculateMri}
            disabled={!selectedWard?.ward_id}
          >
            <HeartPulse size={18} /> Calculate Ward MRI <ArrowRight size={18} />
          </button>
          {mriResult && (
            <div className="mri-result" role="status">
              <strong>
                {mriResult.ward_name} MRI: {mriResult.risk_index.toFixed(2)}
              </strong>
              <span>
                RR {mriResult.relative_risk.toFixed(2)} · VI{" "}
                {mriResult.vulnerability_index.toFixed(2)} · {mriResult.risk_category}
              </span>
            </div>
          )}
          {panelError && (
            <p className="form-feedback error" role="alert">
              {panelError}
            </p>
          )}

          <div className="forecast-block">
            <div className="subheading">
              <div>
              <span className="eyebrow">{riskPreviewMode ? "Fake test forecast" : heatData.data_source === "OPEN_METEO" ? "Model-based forecast" : "Live forecast status"}</span>
              <h2>5-Day Heat Forecast</h2>
              </div>
              <span>°C</span>
            </div>
            <div className="forecast-grid">
              {forecasts.length ? forecasts.map((item, index) => (
                <button
                  className={index === day ? "forecast-card selected" : "forecast-card"}
                  onClick={() => setDay(index)}
                  key={item.short}
                >
                  <span>{index === 0 ? "Today" : item.date.split(", ")[0]}</span>
                  <strong>{item.value}°</strong>
                  <i
                    className={`risk-dot ${item.risk.toLowerCase().replace(" ", "-")}`}
                    style={{ "--risk-color": `var(${riskToken[item.risk]})` } as React.CSSProperties}
                  />
                  <small>{item.risk}</small>
                </button>
              )) : <p className="forecast-unavailable">Live forecast unavailable. Check the backend and weather connection.</p>}
            </div>
          </div>
        </section>

        <section className="map-panel" id="heatmap" aria-label="Mumbai heat-risk GIS map">
          <div className="map-toolbar">
            <div>
              <span className="eyebrow">
                <Layers3 size={13} /> {riskPreviewMode ? `${riskPreviewMode.toUpperCase()}-RISK TEST GIS LAYER` : heatData.data_source === "OPEN_METEO" ? "Live weather GIS layer" : "Weather GIS layer"}
              </span>
              <h2>5-Day Heat Index Forecast</h2>
            </div>
            <div className="day-tabs">
              {forecasts.map((item, index) => (
                <button
                  className={index === day ? "active" : ""}
                  onClick={() => setDay(index)}
                  key={item.short}
                >
                  {item.short}
                </button>
              ))}
            </div>
          </div>
          <div className={`map-canvas day-${day}`}>
            {mounted ? (
              <Suspense fallback={<div className="map-loading">Loading map…</div>}>
                <HeatMap
                  center={[place.lat, place.lng]}
                  zoom={mapZoom}
                  data={heatData}
                  showHeat={showHeat}
                  onReady={onMapReady}
                  onWardSelect={setSelectedWard}
                  selectedWardId={selectedWard?.ward_id}
                  markerRisk={featureAt(heatData, place.lat, place.lng)?.risk_level}
                />
              </Suspense>
            ) : (
              <div className="map-loading">Loading map…</div>
            )}
            <form className="map-search" onSubmit={searchPlace}>
              <Search size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a location…"
                aria-label="Search location"
              />
              <button type="submit" disabled={searching}>
                {searching ? "…" : "Go"}
              </button>
            </form>
            {geoError && <div className="map-error">{geoError}</div>}
            <div className="map-legend">
              <strong>
                Heat Index <small>(Risk Level)</small>
              </strong>
              <div>
                <i className="legend-low" /> 0–20 <span>Low</span>
              </div>
              <div>
                <i className="legend-moderate" /> 21–40 <span>Moderate</span>
              </div>
              <div>
                <i className="legend-high" /> 41–60 <span>High</span>
              </div>
              <div>
                <i className="legend-very-high" /> 61–80 <span>Very High</span>
              </div>
              <div>
                <i className="legend-extreme" /> 81–100 <span>Extreme</span>
              </div>
            </div>
            <div className="map-controls">
              <div className="control-stack">
                <button onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">
                  <Plus />
                </button>
                <button onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">
                  <Minus />
                </button>
              </div>
              <button
                onClick={useMyLocation}
                aria-label="Use my current location"
                title="Use my current location"
              >
                <Crosshair />
              </button>
              <button
                className={layersOpen ? "control-active" : ""}
                onClick={() => setLayersOpen(!layersOpen)}
                aria-label="Map layers"
              >
                <Layers3 />
              </button>
            </div>
            {layersOpen && (
              <div className="layers-popover">
                <strong>Map layers</strong>
                <label>
                  <input
                    type="checkbox"
                    checked={showHeat}
                    onChange={(e) => setShowHeat(e.target.checked)}
                  />{" "}
                  Heat risk
                </label>
              </div>
            )}
          </div>
        </section>

        <section className="city-summary-panel" aria-labelledby="city-summary-title">
          <div>
            <span className="eyebrow">
              {riskPreviewMode
                ? "Risk preview · browser only"
                : heatData.connection_status === "backend"
                ? "Forecast from SQLite-backed API"
                : "Offline demonstration"}
            </span>
            <h2 id="city-summary-title">Ward risk summary</h2>
          </div>
          <div className="risk-counts" aria-label="Ward counts by risk level">
            <span className="count-green">
              Green <b>{riskCounts.GREEN}</b>
            </span>
            <span className="count-yellow">
              Yellow <b>{riskCounts.YELLOW}</b>
            </span>
            <span className="count-orange">
              Orange <b>{riskCounts.ORANGE}</b>
            </span>
            <span className="count-red">
              Red <b>{riskCounts.RED}</b>
            </span>
          </div>
          <div className="top-wards">
            <strong>Highest-risk wards</strong>
            {topWards.length ? (
              <ol>
                {topWards.map((feature) => (
                  <li key={feature.properties.ward_id}>
                    <button type="button" onClick={() => setSelectedWard(feature.properties)}>
                      <span>{feature.properties.ward_name}</span>
                      <b style={{ "--risk-color": `var(${riskToken[feature.properties.risk_level ?? "Moderate"]})` } as React.CSSProperties}>
                        {feature.properties.score}/100 · {feature.properties.risk_level}
                      </b>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>Ward ranking appears when the backend is connected.</p>
            )}
          </div>
        </section>
      </section>

      <section className="service-panels" aria-label="Subscriptions and city actions">
        <section className="service-card" id="subscribe" aria-labelledby="subscribe-title">
          <span className="eyebrow">Consent-based alerts</span>
          <h2 id="subscribe-title">Get heat alerts for your ward</h2>
          <form className="service-form" onSubmit={handleSubscribe}>
            <label>
              Phone number
              <input
                type="tel"
                autoComplete="tel"
                required
                minLength={8}
                maxLength={24}
                placeholder="+91 98765 43210"
                value={subscribePhone}
                onChange={(event) => setSubscribePhone(event.target.value)}
              />
            </label>
            <label>
              Channel
              <select
                value={subscribeChannel}
                onChange={(event) => setSubscribeChannel(event.target.value as "SMS" | "WHATSAPP")}
              >
                <option value="SMS">SMS</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </label>
            <label>
              Ward
              <select
                required
                value={subscribeWardId}
                onChange={(event) => setSubscribeWardId(event.target.value)}
              >
                {wards.map((ward) => (
                  <option key={ward.ward_id} value={ward.ward_id}>
                    {ward.ward_id} · {ward.ward_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="consent-check">
              <input
                type="checkbox"
                required
                checked={subscribeConsent}
                onChange={(event) => setSubscribeConsent(event.target.checked)}
              />{" "}
              I agree to receive heat-safety messages for this ward.
            </label>
            <button
              className="primary-action compact"
              type="submit"
              disabled={savingSubscription || !wards.length}
            >
              {savingSubscription ? "Saving…" : "Subscribe"}
            </button>
          </form>
          {subscribeResult && (
            <p className="form-feedback" role="status">
              {subscribeResult}
            </p>
          )}
        </section>

        <section className="service-card" id="city-actions" aria-labelledby="actions-title">
          <span className="eyebrow">Admin alert delivery · Twilio</span>
          <h2 id="actions-title">Recommended city actions</h2>
          <ul className="action-list">
            {actionPlan.length ? (
              actionPlan.map((action) => (
                <li key={action}>
                  <Check size={15} />
                  {action}
                </li>
              ))
            ) : (
              <li>Action plan loads from the backend.</li>
            )}
          </ul>
          <p className="alert-delivery-note">
            Sends real SMS or WhatsApp alerts to consented subscribers in Orange or Red wards.
            Twilio and the server admin key must be configured.
          </p>
          <label className="admin-key-field">
            Server admin key
            <input
              type="password"
              autoComplete="off"
              value={alertAdminKey}
              onChange={(event) => setAlertAdminKey(event.target.value)}
              placeholder="Enter admin key for this send"
            />
          </label>
          <button
            className="primary-action compact"
            type="button"
            onClick={handleLiveAlert}
            disabled={sendingAlert || !alertAdminKey.trim() || !!riskPreviewMode}
          >
            {sendingAlert ? "Sending…" : "Send live heat alerts"}
          </button>
          {alertResult && (
            <p className="form-feedback" role="status">
              {alertResult}
            </p>
          )}
          {riskPreviewMode === "extreme" && (
            <>
            <div className="push-demo-panel sms-demo-panel">
              <div className="push-demo-heading sms-demo-heading">
                <MessageSquareText size={17} />
                <div>
                  <strong>EXTREME-RISK SMS DEMO</strong>
                  <span>Real Twilio SMS · one opted-in number</span>
                </div>
              </div>
              <div className="push-preview sms-bubble" aria-label="SMS message preview">
                HeatKshetra EXTREME heat alert DEMO for {selectedWard?.ward_name ?? selectedWard?.name ?? "your ward"}. This is a test, not a live emergency. Avoid outdoor activity, move to a cool or shaded place, drink water, and check on neighbours.
              </div>
              <label className="admin-key-field">
                Opted-in SMS subscriber number
                <input
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={demoSmsPhone}
                  onChange={(event) => setDemoSmsPhone(event.target.value)}
                  placeholder="Use the same number subscribed above"
                />
              </label>
              <small className="push-demo-help">
                Subscribe this number with SMS consent in the form above first. Requires Twilio SMS configuration and the server admin key.
              </small>
              <button
                className="primary-action compact push-demo-send sms-demo-send"
                type="button"
                onClick={handleExtremeDemoSms}
                disabled={sendingDemoSms || !alertAdminKey.trim() || !demoSmsPhone.trim()}
              >
                <MessageSquareText size={15} />
                {sendingDemoSms ? "Sending real SMS…" : "Send real demo SMS"}
              </button>
              {demoSmsResult && <p className="form-feedback" role="status">{demoSmsResult}</p>}
            </div>
            <div className="push-demo-panel">
              <div className="push-demo-heading">
                <BellRing size={17} />
                <div>
                  <strong>EXTREME-RISK PUSH DEMO</strong>
                  <span>Real Firebase browser notification · one opted-in device</span>
                </div>
              </div>
              <div className="push-preview" aria-label="Push notification preview">
                HeatKshetra EXTREME heat alert DEMO for {selectedWard?.ward_name ?? selectedWard?.name ?? "your ward"}. This is a test, not a live emergency. Avoid outdoor activity, move to a cool or shaded place, drink water, and check on neighbours.
              </div>
              <label className="push-consent">
                <input type="checkbox" checked={pushConsent} onChange={(event) => setPushConsent(event.target.checked)} />
                I agree to receive a HeatKshetra demo push notification on this browser.
              </label>
              <small className="push-demo-help">
                Requires Firebase web settings in the frontend .env, server credentials in the backend .env, and browser notification permission. This sends push, not SMS.
              </small>
              <button
                className="primary-action compact push-demo-send"
                type="button"
                onClick={handleEnablePush}
                disabled={enablingPush || !pushConsent || !isFirebasePushConfigured()}
              >
                <BellRing size={15} />
                {enablingPush ? "Enabling notifications…" : pushSubscriptionId ? "Push enabled on this browser" : "Enable push on this browser"}
              </button>
              {pushSubscriptionId && (
                <button
                  className="primary-action compact push-demo-send"
                  type="button"
                  onClick={handleExtremeDemoPush}
                  disabled={sendingDemoPush || !alertAdminKey.trim()}
                >
                  <BellRing size={15} />
                  {sendingDemoPush ? "Sending real push…" : "Send real demo push"}
                </button>
              )}
              {pushResult && <p className="form-feedback" role="status">{pushResult}</p>}
            </div>
            </>
          )}
          <div className="alert-log">
            <strong>Recent alert activity</strong>
            {alertLogs.length ? (
              <ul>
                {alertLogs.slice(0, 4).map((entry) => (
                  <li key={entry.id}>
                    <span>
                      {entry.ward_id ?? "City"} · {entry.risk_level}
                    </span>
                    <small>
                      {entry.channel} · {entry.recipients} recipients · {entry.status}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No alerts logged yet.</p>
            )}
          </div>
        </section>
      </section>

      <section className="content-section meaning-section" id="about">
        <div className="section-intro">
          <span className="eyebrow">From weather to wellbeing</span>
          <h2>What does this heat risk mean for you?</h2>
          <p>
            HeatKshetra translates atmospheric conditions into one clear, human-centered decision
            signal.
          </p>
        </div>
        <div className="risk-flow">
          <div className="factor-row">
            <FlowItem
              icon={ThermometerSun}
              title="Forecast temperature"
              text={temperature == null ? "—" : `${temperature.toFixed(1)}°C`}
            />
            <Plus />
            <FlowItem
              icon={Droplets}
              title="Humidity"
              text={humidity == null ? "—" : `${Math.round(humidity)}%`}
            />
            <Plus />
            <FlowItem
              icon={Wind}
              title="Wind"
              text={windSpeed == null ? "—" : `${(windSpeed * 3.6).toFixed(1)} km/h`}
            />
            <Plus />
            <FlowItem
              icon={Sun}
              title="Solar radiation"
              text={
                selectedWard?.solar_wm2 == null ? "—" : `${Math.round(selectedWard.solar_wm2)} W/m²`
              }
            />
            <Plus />
            <FlowItem icon={MapPin} title="Ward" text={selectedWard?.ward_name ?? place.name} />
          </div>
          <ArrowRight className="flow-arrow" />
          <div className="flow-result stress">
            <Activity />
            <span>
              <small>COMBINED EFFECT</small>
              <strong>Human Heat Stress</strong>
            </span>
          </div>
          <ArrowRight className="flow-arrow" />
          <div className="flow-result final">
            <ShieldAlert style={activeRiskStyle} />
            <span>
              <small>ACTION SIGNAL</small>
              <strong>
                {activeRisk} Risk · {activeScore}/100
              </strong>
            </span>
          </div>
        </div>
      </section>

      <section className="content-section exposed-section">
        <div className="section-intro">
          <span className="eyebrow">Exposure profiles</span>
          <h2>Who is at risk?</h2>
          <p>
            Heat affects everyone differently. Guidance changes with sensitivity, exposure, and
            exertion.
          </p>
        </div>
        <div className="people-grid">
          <RiskCard
            icon={Accessibility}
            title="Children"
            level="High sensitivity"
            text="Children heat up faster and may miss early warning signs."
            action="Schedule play outside peak hours."
          />
          <RiskCard
            icon={PersonStanding}
            title="Adults"
            level="Elevated risk"
            text="Commutes and sustained outdoor activity increase heat strain."
            action="Carry water and pace activity."
          />
          <RiskCard
            icon={HeartPulse}
            title="Elderly"
            level="Extra caution"
            text="Reduced heat regulation can make hot periods more stressful."
            action="Stay cool and check in regularly."
          />
          <RiskCard
            icon={BriefcaseBusiness}
            title="Outdoor workers & athletes"
            level="Very high exposure"
            text="Heat combined with physical exertion raises risk quickly."
            action="Use shaded breaks and work-rest cycles."
          />
        </div>
      </section>

      <section className="content-section decision-section" id="risk-analysis">
        <div className="decision-card">
          <div className="decision-main">
            <span className="eyebrow">
              <Navigation size={13} /> Decision support
            </span>
            <h2>Going outside right now?</h2>
            <div className="decision-risk">
              <AlertTriangle style={activeRiskStyle} />
              <span>
                <small>CURRENT RECOMMENDATION</small>
                <strong>{activeRisk?.toUpperCase() ?? "LIVE WEATHER UNAVAILABLE"} RISK</strong>
              </span>
            </div>
            <p>{advisory?.text ?? "Connect the backend to load guidance for the selected ward."}</p>
          </div>
          <div className="checklist">
            {(advisory?.actions ?? ["Connect to the backend for current guidance."])
              .slice(0, 4)
              .map((action) => (
                <p key={action}>
                  <Check /> {action}
                </p>
              ))}
          </div>
          <div className="day-timeline">
            <div>
              <span>Morning</span>
              <small>Use shade</small>
            </div>
            <div className="peak">
              <span>12–4 PM</span>
              <small>Reduce exertion</small>
            </div>
            <div>
              <span>Evening</span>
              <small>Check on neighbours</small>
            </div>
          </div>
        </div>
      </section>

      <section className="content-section comparison-section">
        <div className="section-intro">
          <span className="eyebrow">Why heat index matters</span>
          <h2>Temperature alone isn’t enough</h2>
          <p>The same thermometer reading can feel very different to the human body.</p>
        </div>
        <div className="comparison-grid">
          <Comparison
            humidity="35%"
            title="38°C + LOW HUMIDITY"
            value="Lower heat stress"
            variant="lower"
            description="Sweat evaporates more effectively, helping the body release heat."
          />
          <div className="versus">VS</div>
          <Comparison
            humidity="72%"
            title="38°C + HIGH HUMIDITY"
            value="Higher heat stress"
            variant="higher"
            description="Slower evaporation traps more body heat and raises perceived temperature."
          />
        </div>
      </section>

      <section className="regional-section">
        <div className="regional-copy">
          <span className="eyebrow">
            <Layers3 size={13} /> Spatial intelligence
          </span>
          <h2>Heatwave Risk Across Your Region</h2>
          <p>
            See where dangerous heat is concentrated across Mumbai, compare neighborhoods, and plan
            safer movement.
          </p>
          <a className="primary-action compact" href="#heatmap">
            Explore Interactive Heatmap <ArrowRight />
          </a>
        </div>
        <div className="mini-map">
          <img
            src={mumbaiMap}
            alt="Regional Mumbai heat risk preview"
            loading="lazy"
            width={1536}
            height={1152}
          />
          <div className="heat-zone hz-2" />
          <div className="heat-zone hz-3" />
          <div className="heat-zone hz-5" />
          <div className="mini-boundary" />
          <div className="location-pin">
            <span>
              <MapPin size={16} />
            </span>
            <i />
          </div>
          <div className="mini-legend">
            <i /> Low <i /> Moderate <i /> High <i /> Extreme
          </div>
        </div>
      </section>
      <footer>
        <div className="brand">
          <span className="brand-mark">
            <Sun size={18} />
          </span>
          <strong>HeatKshetra</strong>
        </div>
        <p>Smart India Hackathon 2026 · Problem Statement 83</p>
        <span>Weather intelligence for human resilience.</span>
      </footer>
    </main>
  );
}

function FlowItem({ icon: Icon, title, text }: { icon: typeof Sun; title: string; text: string }) {
  return (
    <div className="flow-item">
      <Icon />
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
    </div>
  );
}
function RiskCard({
  icon: Icon,
  title,
  level,
  text,
  action,
}: {
  icon: typeof Sun;
  title: string;
  level: string;
  text: string;
  action: string;
}) {
  return (
    <article className="person-card">
      <div className="person-icon">
        <Icon />
      </div>
      <span className="risk-level">
        <i /> {level}
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      <div>
        <Check />{" "}
        <span>
          <small>WHAT TO DO</small>
          {action}
        </span>
      </div>
    </article>
  );
}
function Comparison({
  humidity,
  title,
  value,
  description,
  variant,
}: {
  humidity: string;
  title: string;
  value: string;
  description: string;
  variant: string;
}) {
  return (
    <article className={`comparison-card ${variant}`}>
      <div className="humidity-orbit">
        <Droplets />
        <strong>{humidity}</strong>
        <span>humidity</span>
      </div>
      <div>
        <span className="eyebrow">Same air temperature</span>
        <h3>{title}</h3>
        <strong className="comparison-result">{value}</strong>
        <p>{description}</p>
      </div>
    </article>
  );
}
