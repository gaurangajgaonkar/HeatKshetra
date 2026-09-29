-- SQLite development schema. Geometry is stored as GeoJSON text so the
-- project can run without PostGIS; a PostGIS migration can add native geometry.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wards (
    ward_id INTEGER PRIMARY KEY AUTOINCREMENT,
    ward_code TEXT NOT NULL UNIQUE,
    ward_name TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT 'Mumbai',
    geometry_geojson TEXT,
    source_properties_json TEXT,
    population INTEGER CHECK (population IS NULL OR population >= 0),
    population_2011 INTEGER CHECK (population_2011 IS NULL OR population_2011 >= 0),
    population_source_year INTEGER,
    population_estimate_year INTEGER,
    population_is_projected INTEGER NOT NULL DEFAULT 1 CHECK (population_is_projected IN (0, 1)),
    population_confidence TEXT,
    population_source TEXT,
    baseline_daily_deaths REAL CHECK (baseline_daily_deaths IS NULL OR baseline_daily_deaths >= 0),
    population_updated_at TEXT,
    elderly_pct REAL CHECK (elderly_pct IS NULL OR elderly_pct BETWEEN 0 AND 100),
    outdoor_worker_pct REAL CHECK (outdoor_worker_pct IS NULL OR outdoor_worker_pct BETWEEN 0 AND 100),
    informal_housing_pct REAL CHECK (informal_housing_pct IS NULL OR informal_housing_pct BETWEEN 0 AND 100),
    comorbidity_proxy REAL CHECK (comorbidity_proxy IS NULL OR comorbidity_proxy BETWEEN 0 AND 100),
    pop_density REAL CHECK (pop_density IS NULL OR pop_density >= 0),
    green_cover_pct REAL CHECK (green_cover_pct IS NULL OR green_cover_pct BETWEEN 0 AND 100),
    is_placeholder INTEGER NOT NULL DEFAULT 1 CHECK (is_placeholder IN (0, 1)),
    source TEXT NOT NULL DEFAULT 'unknown',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS weather_obs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ward_id INTEGER NOT NULL REFERENCES wards(ward_id) ON DELETE CASCADE,
    ts TEXT NOT NULL,
    temp_c REAL,
    rh_pct REAL CHECK (rh_pct IS NULL OR rh_pct BETWEEN 0 AND 100),
    wind_ms REAL CHECK (wind_ms IS NULL OR wind_ms >= 0),
    solar_wm2 REAL CHECK (solar_wm2 IS NULL OR solar_wm2 >= 0),
    source TEXT NOT NULL,
    is_forecast INTEGER NOT NULL DEFAULT 0 CHECK (is_forecast IN (0, 1)),
    UNIQUE (ward_id, ts, source, is_forecast)
);

CREATE INDEX IF NOT EXISTS idx_weather_obs_ward_ts
    ON weather_obs (ward_id, ts);

CREATE TABLE IF NOT EXISTS thermal_indices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ward_id INTEGER NOT NULL REFERENCES wards(ward_id) ON DELETE CASCADE,
    ts TEXT NOT NULL,
    wbgt REAL,
    utci REAL,
    heat_index REAL,
    source TEXT NOT NULL DEFAULT 'unknown',
    is_simulated INTEGER NOT NULL DEFAULT 1 CHECK (is_simulated IN (0, 1)),
    UNIQUE (ward_id, ts)
);

CREATE TABLE IF NOT EXISTS risk_forecast (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ward_id INTEGER NOT NULL REFERENCES wards(ward_id) ON DELETE CASCADE,
    target_date TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    lead_days INTEGER NOT NULL CHECK (lead_days BETWEEN 1 AND 5),
    mri REAL,
    risk_level TEXT CHECK (risk_level IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
    expected_excess_deaths REAL,
    is_simulated INTEGER NOT NULL DEFAULT 1 CHECK (is_simulated IN (0, 1)),
    UNIQUE (ward_id, target_date, issued_at)
);

CREATE INDEX IF NOT EXISTS idx_risk_forecast_date
    ON risk_forecast (target_date, risk_level);

CREATE TABLE IF NOT EXISTS health_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ward_id INTEGER NOT NULL REFERENCES wards(ward_id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    deaths INTEGER CHECK (deaths IS NULL OR deaths >= 0),
    heat_admissions INTEGER CHECK (heat_admissions IS NULL OR heat_admissions >= 0),
    is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK (is_synthetic IN (0, 1)),
    UNIQUE (ward_id, date)
);

CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('SMS', 'WHATSAPP')),
    ward_id INTEGER NOT NULL REFERENCES wards(ward_id) ON DELETE CASCADE,
    language TEXT NOT NULL DEFAULT 'en',
    consent INTEGER NOT NULL DEFAULT 0 CHECK (consent IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscribers_ward_channel
    ON subscribers (ward_id, channel);

CREATE TABLE IF NOT EXISTS alerts_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ward_id INTEGER REFERENCES wards(ward_id) ON DELETE SET NULL,
    risk_level TEXT CHECK (risk_level IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
    channel TEXT CHECK (channel IN ('SMS', 'WHATSAPP', 'DRY_RUN')),
    recipients INTEGER NOT NULL DEFAULT 0 CHECK (recipients >= 0),
    message TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    ward_id INTEGER NOT NULL REFERENCES wards(ward_id) ON DELETE CASCADE,
    consent INTEGER NOT NULL DEFAULT 0 CHECK (consent IN (0, 1)),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_ward
    ON push_subscriptions (ward_id, enabled, consent);

CREATE TABLE IF NOT EXISTS push_delivery_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ward_id INTEGER REFERENCES wards(ward_id) ON DELETE SET NULL,
    risk_level TEXT CHECK (risk_level IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
    recipients INTEGER NOT NULL DEFAULT 0 CHECK (recipients >= 0),
    message TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL
);
