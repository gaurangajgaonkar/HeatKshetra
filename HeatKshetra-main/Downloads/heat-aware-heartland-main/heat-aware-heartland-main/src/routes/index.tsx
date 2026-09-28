import { createFileRoute } from "@tanstack/react-router";
import {
  Accessibility,
  Activity,
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Crosshair,
  Droplets,
  HeartPulse,
  Languages,
  Layers3,
  MapPin,
  Menu,
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
import { fetchHeatRisk, mockHeatRisk, riskLevel, scoreAt, type HeatRiskCollection } from "@/lib/heat-risk";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Heatkshetra — Mumbai Human Heat-Risk Dashboard" },
      { name: "description", content: "Monitor Mumbai heatwave intensity, human heat stress, and location-based safety guidance on a GIS dashboard." },
      { property: "og:title", content: "Heatkshetra — Human Heat-Risk Dashboard" },
      { property: "og:description", content: "Weather data, GIS intelligence, and actionable human heat-risk guidance for Mumbai." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HeatkshetraDashboard,
});

const forecasts = [
  { short: "Today", date: "Tue, Apr 29", value: 43, risk: "High", score: 67 },
  { short: "Wed, Apr 30", date: "Wed, Apr 30", value: 46, risk: "Very High", score: 74 },
  { short: "Thu, May 1", date: "Thu, May 1", value: 49, risk: "Very High", score: 79 },
  { short: "Fri, May 2", date: "Fri, May 2", value: 45, risk: "High", score: 71 },
  { short: "Sat, May 3", date: "Sat, May 3", value: 38, risk: "Moderate", score: 53 },
];

const metrics = [
  { label: "Temperature", value: "36°C", icon: ThermometerSun },
  { label: "Humidity", value: "72%", icon: Droplets },
  { label: "Heat Index", value: "43°C", icon: Zap, emphasis: true },
  { label: "Wind Speed", value: "11 km/h", icon: Wind },
  { label: "UV Index", value: "8 High", icon: Sun },
];

const HeatMap = lazy(() => import("@/components/HeatMap"));

function HeatkshetraDashboard() {
  const [day, setDay] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showHeat, setShowHeat] = useState(true);
  const [place, setPlace] = useState({ name: "Mumbai (Bandra)", lat: 19.0596, lng: 72.8295 });
  const [heatData, setHeatData] = useState<HeatRiskCollection>(() => mockHeatRisk(0));
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const mapRef = useRef<MapHandle | null>(null);
  const onMapReady = useCallback((h: MapHandle) => { mapRef.current = h; }, []);
  const active = forecasts[day] ?? { short: "Today", date: "Tue, Apr 29", value: 43, risk: "High", score: 67 };
  const placeScore = scoreAt(heatData, place.lat, place.lng);

  useEffect(() => setMounted(true), []);
  useEffect(() => { let live = true; fetchHeatRisk(day).then((d) => live && setHeatData(d)); return () => { live = false; }; }, [day]);

  const useMyLocation = () => {
    setGeoError(null);
    if (!navigator.geolocation) return setGeoError("Location isn't available in this browser.");
    navigator.geolocation.getCurrentPosition(
      (p) => setPlace({ name: "My current location", lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setGeoError("Couldn't get your location. Please allow location access."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const searchPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true); setGeoError(null);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`);
      const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      if (!hit) setGeoError("No matching location found.");
      else setPlace({ name: hit.display_name.split(",").slice(0, 2).join(","), lat: +hit.lat, lng: +hit.lon });
    } catch { setGeoError("Search failed. Try again."); }
    setSearching(false);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Heatkshetra home">
          <span className="brand-mark"><Sun size={21} /></span>
          <span><strong>Heatkshetra</strong><small>Heatwave Risk Detection & GIS Dashboard</small></span>
        </a>
        <nav className={mobileOpen ? "nav-links nav-open" : "nav-links"} aria-label="Main navigation">
          <a href="#top">Home</a><a href="#heatmap">Heatmap</a><a href="#risk-analysis">Risk Analysis</a><a href="#alerts">Alerts</a><a href="#about">About</a>
        </nav>
        <div className="nav-status">
          <span><MapPin size={14} /> Mumbai, India</span>
          <span className="live"><i /> Live</span>
          <time>Tue, 29 Apr 2025 <b>12:42 PM</b></time>
          <button className="icon-button" aria-label="Accessibility and language"><Languages size={18} /></button>
          <button className="menu-button" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">{mobileOpen ? <X /> : <Menu />}</button>
        </div>
      </header>

      <section className="dashboard-shell" id="top">
        <section className="risk-panel" aria-labelledby="risk-title">
          <div className="panel-heading">
            <div><span className="eyebrow"><Activity size={13} /> Live personal assessment</span><h1 id="risk-title">Current Heatwave Risk</h1></div>
            <span className="updated">Updated 2 min ago</span>
          </div>

          <div className="risk-summary">
            <div className="gauge" style={{ "--score": `${active.score * 3.6}deg` } as React.CSSProperties}>
              <div><strong>{active.score}</strong><span>/100</span></div>
            </div>
            <div className="risk-copy">
              <span className={active.risk === "Moderate" ? "risk-badge moderate" : "risk-badge"}>{active.risk.toUpperCase()} RISK</span>
              <p>Heatwave conditions are significant.</p>
              <small>Limit prolonged outdoor activity, especially during peak hours.</small>
            </div>
          </div>

          <div className="metrics-grid">
            {metrics.map(({ label, value, icon: Icon, emphasis }) => (
              <div className={emphasis ? "metric emphasis" : "metric"} key={label}>
                <span><Icon size={15} /> {label}</span><strong>{value}</strong>
              </div>
            ))}
          </div>

          <div className="advisory" id="alerts">
            <div className="advisory-icon"><AlertTriangle size={20} /></div>
            <div><strong>HEALTH ADVISORY</strong><p>Avoid prolonged outdoor activity during peak heat.</p><small>Stay hydrated, wear light clothing and take regular breaks in shaded or cool areas.</small></div>
          </div>

          <a className="primary-action" href="#risk-analysis"><HeartPulse size={18} /> Calculate Mortality Risk <ArrowRight size={18} /></a>

          <div className="forecast-block">
            <div className="subheading"><div><span className="eyebrow">Human-perceived temperature</span><h2>5-Day Heat Index Forecast</h2></div><span>°C</span></div>
            <div className="forecast-grid">
              {forecasts.map((item, index) => (
                <button className={index === day ? "forecast-card selected" : "forecast-card"} onClick={() => setDay(index)} key={item.short}>
                  <span>{index === 0 ? "Today" : item.date.split(", ")[0]}</span>
                  <strong>{item.value}°</strong>
                  <i className={`risk-dot ${item.risk.toLowerCase().replace(" ", "-")}`} />
                  <small>{item.risk}</small>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="map-panel" id="heatmap" aria-label="Mumbai heat-risk GIS map">
          <div className="map-toolbar">
            <div><span className="eyebrow"><Layers3 size={13} /> GIS forecast layer</span><h2>5-Day Heat Index Forecast</h2></div>
            <div className="day-tabs">
              {forecasts.map((item, index) => <button className={index === day ? "active" : ""} onClick={() => setDay(index)} key={item.short}>{item.short}</button>)}
            </div>
          </div>
          <div className={`map-canvas day-${day}`}>
            {mounted ? (
              <Suspense fallback={<div className="map-loading">Loading map…</div>}>
                <HeatMap center={[place.lat, place.lng]} data={heatData} showHeat={showHeat} label={place.name} onReady={onMapReady} />
              </Suspense>
            ) : <div className="map-loading">Loading map…</div>}
            <form className="map-search" onSubmit={searchPlace}>
              <Search size={14} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a location…" aria-label="Search location" />
              <button type="submit" disabled={searching}>{searching ? "…" : "Go"}</button>
            </form>
            {geoError && <div className="map-error">{geoError}</div>}
            <div className="map-legend">
              <strong>Heat Index <small>(Risk Level)</small></strong>
              <div><i className="legend-low" /> 0–20 <span>Low</span></div><div><i className="legend-moderate" /> 21–40 <span>Moderate</span></div><div><i className="legend-high" /> 41–60 <span>High</span></div><div><i className="legend-very-high" /> 61–80 <span>Very High</span></div><div><i className="legend-extreme" /> 81–100 <span>Extreme</span></div>
            </div>
            <div className="map-controls">
              <div className="control-stack"><button onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in"><Plus /></button><button onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out"><Minus /></button></div>
              <button onClick={useMyLocation} aria-label="Use my current location" title="Use my current location"><Crosshair /></button>
              <button className={layersOpen ? "control-active" : ""} onClick={() => setLayersOpen(!layersOpen)} aria-label="Map layers"><Layers3 /></button>
            </div>
            {layersOpen && <div className="layers-popover"><strong>Map layers</strong><label><input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} /> Heat risk</label></div>}
            <div className="selected-location"><span className="pin-mini"><Navigation size={14} /></span><div><small>SELECTED LOCATION</small><strong>{place.name}</strong><p>{place.lat.toFixed(4)}, {place.lng.toFixed(4)}</p><p>Zone risk: {placeScore ?? "—"}{placeScore != null && <b> • {riskLevel(placeScore)}</b>} · Heat Index {active.value}°C</p></div></div>
          </div>
        </section>
      </section>

      <section className="content-section meaning-section" id="about">
        <div className="section-intro"><span className="eyebrow">From weather to wellbeing</span><h2>What does this heat risk mean for you?</h2><p>Heatkshetra translates atmospheric conditions into one clear, human-centered decision signal.</p></div>
        <div className="risk-flow">
          <div className="factor-row"><FlowItem icon={ThermometerSun} title="Temperature" text="36°C ambient" /><Plus /><FlowItem icon={Droplets} title="Humidity" text="72% moisture" /><Plus /><FlowItem icon={Wind} title="Wind" text="11 km/h" /><Plus /><FlowItem icon={Sun} title="UV" text="Index 8" /><Plus /><FlowItem icon={MapPin} title="Location" text="Bandra" /></div>
          <ArrowRight className="flow-arrow" />
          <div className="flow-result stress"><Activity /><span><small>COMBINED EFFECT</small><strong>Human Heat Stress</strong></span></div>
          <ArrowRight className="flow-arrow" />
          <div className="flow-result final"><ShieldAlert /><span><small>ACTION SIGNAL</small><strong>High Risk · 67/100</strong></span></div>
        </div>
      </section>

      <section className="content-section exposed-section">
        <div className="section-intro"><span className="eyebrow">Exposure profiles</span><h2>Who is at risk?</h2><p>Heat affects everyone differently. Guidance changes with sensitivity, exposure, and exertion.</p></div>
        <div className="people-grid">
          <RiskCard icon={Accessibility} title="Children" level="High sensitivity" text="Children heat up faster and may miss early warning signs." action="Schedule play outside peak hours." />
          <RiskCard icon={PersonStanding} title="Adults" level="Elevated risk" text="Commutes and sustained outdoor activity increase heat strain." action="Carry water and pace activity." />
          <RiskCard icon={HeartPulse} title="Elderly" level="Extra caution" text="Reduced heat regulation can make hot periods more stressful." action="Stay cool and check in regularly." />
          <RiskCard icon={BriefcaseBusiness} title="Outdoor workers & athletes" level="Very high exposure" text="Heat combined with physical exertion raises risk quickly." action="Use shaded breaks and work-rest cycles." />
        </div>
      </section>

      <section className="content-section decision-section" id="risk-analysis">
        <div className="decision-card">
          <div className="decision-main"><span className="eyebrow"><Navigation size={13} /> Decision support</span><h2>Going outside right now?</h2><div className="decision-risk"><AlertTriangle /><span><small>CURRENT RECOMMENDATION</small><strong>HIGH RISK</strong></span></div><p>Outdoor activity is not recommended during peak heat.</p></div>
          <div className="checklist"><p><Check /> Safer time: <strong>Before 10 AM / After 5 PM</strong></p><p><Check /> Stay hydrated</p><p><Check /> Take regular breaks</p><p><Check /> Avoid prolonged direct sun exposure</p></div>
          <div className="day-timeline"><div><span>Morning</span><small>Moderate</small></div><div className="peak"><span>Afternoon</span><small>Very High</small></div><div><span>Evening</span><small>Moderate</small></div></div>
        </div>
      </section>

      <section className="content-section comparison-section">
        <div className="section-intro"><span className="eyebrow">Why heat index matters</span><h2>Temperature alone isn’t enough</h2><p>The same thermometer reading can feel very different to the human body.</p></div>
        <div className="comparison-grid">
          <Comparison humidity="35%" title="38°C + LOW HUMIDITY" value="Lower heat stress" variant="lower" description="Sweat evaporates more effectively, helping the body release heat." />
          <div className="versus">VS</div>
          <Comparison humidity="72%" title="38°C + HIGH HUMIDITY" value="Higher heat stress" variant="higher" description="Slower evaporation traps more body heat and raises perceived temperature." />
        </div>
      </section>

      <section className="regional-section">
        <div className="regional-copy"><span className="eyebrow"><Layers3 size={13} /> Spatial intelligence</span><h2>Heatwave Risk Across Your Region</h2><p>See where dangerous heat is concentrated across Mumbai, compare neighborhoods, and plan safer movement.</p><a className="primary-action compact" href="#heatmap">Explore Interactive Heatmap <ArrowRight /></a></div>
        <div className="mini-map"><img src={mumbaiMap} alt="Regional Mumbai heat risk preview" loading="lazy" width={1536} height={1152} /><div className="heat-zone hz-2" /><div className="heat-zone hz-3" /><div className="heat-zone hz-5" /><div className="mini-boundary" /><div className="location-pin"><span><MapPin size={16} /></span><i /></div><div className="mini-legend"><i /> Low <i /> Moderate <i /> High <i /> Extreme</div></div>
      </section>
      <footer><div className="brand"><span className="brand-mark"><Sun size={18} /></span><strong>Heatkshetra</strong></div><p>Smart India Hackathon 2026 · Problem Statement 83</p><span>Weather intelligence for human resilience.</span></footer>
    </main>
  );
}

function FlowItem({ icon: Icon, title, text }: { icon: typeof Sun; title: string; text: string }) { return <div className="flow-item"><Icon /><span><strong>{title}</strong><small>{text}</small></span></div>; }
function RiskCard({ icon: Icon, title, level, text, action }: { icon: typeof Sun; title: string; level: string; text: string; action: string }) { return <article className="person-card"><div className="person-icon"><Icon /></div><span className="risk-level"><i /> {level}</span><h3>{title}</h3><p>{text}</p><div><Check /> <span><small>WHAT TO DO</small>{action}</span></div></article>; }
function Comparison({ humidity, title, value, description, variant }: { humidity: string; title: string; value: string; description: string; variant: string }) { return <article className={`comparison-card ${variant}`}><div className="humidity-orbit"><Droplets /><strong>{humidity}</strong><span>humidity</span></div><div><span className="eyebrow">Same air temperature</span><h3>{title}</h3><strong className="comparison-result">{value}</strong><p>{description}</p></div></article>; }

