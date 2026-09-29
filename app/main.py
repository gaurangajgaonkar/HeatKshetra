"""FastAPI application for HeatKshetra's ward map and heat-risk data."""

from __future__ import annotations

import base64
import asyncio
import json
import logging
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.database import connect_db, initialize_database, table_count
from app.demo_data import refresh_demo_forecasts
from app.exposure import compute_heat_index_c, compute_simplified_wbgt_c
from app.heat_risk import classify_risk, heat_health_risk
from app.population import refresh_population_projection
from app.risk_levels import RISK_LEVEL_ORDER, dashboard_risk
from app.schemas import AlertTriggerRequest, CityRiskResponse, PushDemoRequest, PushSubscriptionRequest, SmsDemoRequest, SubscribeRequest, Ward, WardRiskResponse
from app.weather_provider import SOURCE as LIVE_WEATHER_SOURCE, refresh_live_weather


INDIA_TZ = timezone(timedelta(hours=5, minutes=30))
LOGGER = logging.getLogger(__name__)
RISK_LEVELS = ("GREEN", "YELLOW", "ORANGE", "RED")
UI_TO_ALERT_LEVEL = {
    "LOW": "GREEN",
    "MODERATE": "YELLOW",
    "HIGH": "ORANGE",
    "VERY HIGH": "RED",
    "EXTREME": "RED",
}
ADVISORIES = {
    "GREEN": {
        "title": "Routine heat precautions",
        "text": "Drink water regularly, use shade when possible, and check local updates.",
        "actions": ["Carry drinking water", "Use shade during the hottest hours", "Check on neighbours who may need help"],
    },
    "YELLOW": {
        "title": "Increased heat caution",
        "text": "Heat may affect people outdoors for long periods. Plan breaks and avoid the hottest hours.",
        "actions": ["Drink water often", "Reduce strenuous activity from noon to 4 PM", "Check on children and older adults"],
    },
    "ORANGE": {
        "title": "High heat risk",
        "text": "Limit prolonged outdoor activity during peak heat and move to a cool place if you feel unwell.",
        "actions": ["Avoid strenuous outdoor work from noon to 4 PM", "Drink water and take shaded breaks", "Check on neighbours and outdoor workers"],
    },
    "RED": {
        "title": "Very high heat risk",
        "text": "Dangerous heat conditions are possible. Keep cool and seek urgent help for heat illness symptoms.",
        "actions": ["Avoid outdoor activity during peak heat", "Use a cooling centre or shaded indoor space", "Call local emergency services for severe symptoms"],
    },
}
ACTION_PLANS = {
    "GREEN": ["Maintain routine public-health monitoring", "Keep cooling-centre information current"],
    "YELLOW": ["Review cooling-centre readiness", "Share heat-safety guidance with local facilities"],
    "ORANGE": ["Open designated cooling centres", "Coordinate water access and outreach", "Review outdoor work-hour guidance"],
    "RED": ["Activate the city heat action plan", "Open cooling centres and public water points", "Coordinate health services and power-grid readiness", "Issue public alerts"],
}


async def _refresh_live_weather_periodically() -> None:
    interval_minutes = max(5, int(os.getenv("WEATHER_REFRESH_MINUTES", "30")))
    while True:
        await asyncio.sleep(interval_minutes * 60)
        try:
            await asyncio.to_thread(refresh_population_projection)
            await asyncio.to_thread(refresh_live_weather)
        except Exception:
            LOGGER.exception("Scheduled population/weather refresh failed; keeping the last successful cache.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    population_status = refresh_population_projection()
    LOGGER.info(
        "Loaded population data for %d wards (CAGR %.4f%%, estimate year %d).",
        population_status["ward_count"],
        population_status["annual_growth_rate"] * 100,
        population_status["target_year"],
    )
    data_mode = os.getenv("DATA_MODE", "live").strip().lower()
    if data_mode == "simulated":
        refresh_demo_forecasts()
        yield
        return
    if data_mode != "live":
        raise RuntimeError("DATA_MODE must be 'live' or 'simulated'.")

    try:
        await asyncio.to_thread(refresh_live_weather)
    except Exception:
        LOGGER.exception("Initial live weather refresh failed; the dashboard will report weather unavailable.")
    refresh_task = asyncio.create_task(_refresh_live_weather_periodically())
    try:
        yield
    finally:
        refresh_task.cancel()
        try:
            await refresh_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="HeatKshetra API",
    description="Ward-level heat-risk data, five-day forecasts, and public-health actions for Mumbai.",
    version="1.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Key"],
)


def _today() -> date:
    return datetime.now(INDIA_TZ).date()


def _live_mode() -> bool:
    return os.getenv("DATA_MODE", "live").strip().lower() == "live"


def _forecast_rows(target_date: date) -> list[dict[str, Any]]:
    with connect_db() as connection:
        rows = connection.execute(
            """
            SELECT
                w.ward_id, w.ward_code, w.ward_name, w.geometry_geojson,
                w.population, w.population_2011, w.population_source_year,
                w.population_estimate_year, w.population_is_projected,
                w.population_confidence, w.population_source, w.baseline_daily_deaths,
                w.elderly_pct, w.outdoor_worker_pct, w.informal_housing_pct,
                w.comorbidity_proxy, w.is_placeholder, w.source AS ward_source,
                rf.target_date, rf.issued_at, rf.lead_days, rf.mri, rf.risk_level AS alert_level,
                rf.is_simulated, rf.expected_excess_deaths, wo.ts AS weather_time,
                wo.temp_c, wo.rh_pct, wo.wind_ms, wo.solar_wm2,
                wo.source AS weather_source, ti.wbgt, ti.heat_index
            FROM risk_forecast rf
            JOIN wards w ON w.ward_id = rf.ward_id
            LEFT JOIN weather_obs wo
              ON wo.ward_id = rf.ward_id
             AND wo.ts LIKE rf.target_date || '%'
             AND wo.is_forecast = 1
            LEFT JOIN thermal_indices ti
              ON ti.ward_id = rf.ward_id
             AND ti.ts = wo.ts
             AND ti.source = wo.source
            WHERE rf.target_date = ?
            ORDER BY w.ward_code
            """,
            (target_date.isoformat(),),
        ).fetchall()

    results: list[dict[str, Any]] = []
    for row in rows:
        data = dict(row)
        if data["temp_c"] is None:
            continue
        risk = heat_health_risk(
            temp_c=data["temp_c"],
            elderly_pct=data["elderly_pct"],
            outdoor_worker_pct=data["outdoor_worker_pct"],
            informal_housing_pct=data["informal_housing_pct"],
            comorbidity_proxy=data["comorbidity_proxy"],
        )
        dashboard = dashboard_risk(data["mri"])
        data.update(
            risk_category=classify_risk(data["mri"]),
            map_risk_level=dashboard["label"],
            score=dashboard["score"],
            relative_risk=risk["relative_risk"],
            vulnerability_index=risk["vulnerability_index"],
            heat_index_c=data["heat_index"],
            simplified_wbgt_c=data["wbgt"],
            expected_excess_deaths=_estimate_excess_deaths(data),
        )
        results.append(data)
    return results


def _current_weather_rows() -> list[dict[str, Any]]:
    with connect_db() as connection:
        rows = connection.execute(
            """
            SELECT w.ward_id, w.ward_code, w.ward_name, w.geometry_geojson,
                   w.population, w.population_2011, w.population_source_year,
                   w.population_estimate_year, w.population_is_projected,
                   w.population_confidence, w.population_source, w.baseline_daily_deaths,
                   w.elderly_pct, w.outdoor_worker_pct, w.informal_housing_pct,
                   w.comorbidity_proxy, w.is_placeholder, w.source AS ward_source,
                   wo.ts AS weather_time, wo.temp_c, wo.rh_pct, wo.wind_ms, wo.solar_wm2,
                   wo.source AS weather_source, ti.wbgt, ti.heat_index
            FROM wards w
            JOIN weather_obs wo
              ON wo.ward_id = w.ward_id
             AND wo.source = ?
             AND wo.is_forecast = 0
            LEFT JOIN thermal_indices ti
              ON ti.ward_id = wo.ward_id
             AND ti.ts = wo.ts
             AND ti.source = wo.source
            ORDER BY w.ward_code
            """,
            (LIVE_WEATHER_SOURCE,),
        ).fetchall()

    results: list[dict[str, Any]] = []
    for row in rows:
        data = dict(row)
        risk = heat_health_risk(
            temp_c=data["temp_c"],
            elderly_pct=data["elderly_pct"],
            outdoor_worker_pct=data["outdoor_worker_pct"],
            informal_housing_pct=data["informal_housing_pct"],
            comorbidity_proxy=data["comorbidity_proxy"],
        )
        dashboard = dashboard_risk(risk["risk_index"])
        data.update(
            target_date=data["weather_time"][:10],
            issued_at=data["weather_time"],
            lead_days=0,
            mri=risk["risk_index"],
            alert_level=dashboard["alert_level"],
            is_simulated=False,
            is_current=True,
            observed_at=data["weather_time"],
            risk_category=classify_risk(risk["risk_index"]),
            map_risk_level=dashboard["label"],
            score=dashboard["score"],
            relative_risk=risk["relative_risk"],
            vulnerability_index=risk["vulnerability_index"],
            heat_index_c=data["heat_index"],
            simplified_wbgt_c=data["wbgt"],
            expected_excess_deaths=_estimate_excess_deaths(data),
        )
        results.append(data)
    return results


def _estimate_excess_deaths(row: dict[str, Any]) -> float | None:
    baseline = row.get("baseline_daily_deaths")
    mri = row.get("mri")
    if baseline is None or mri is None:
        return None
    # Illustrative estimate only: the baseline is a crude city-wide mortality proxy.
    return round(max(0.0, float(baseline) * (float(mri) - 1.0)), 1)


def _ward_row(ward_code: str) -> dict[str, Any]:
    with connect_db() as connection:
        row = connection.execute(
            "SELECT * FROM wards WHERE lower(ward_code) = lower(?)",
            (ward_code,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Ward '{ward_code}' was not found.")
    return dict(row)


def _calculate_ward_risk(
    ward: dict[str, Any],
    temperature_c: float,
    humidity_pct: float,
    wind_speed_ms: float,
    data_source: str = "WEATHER_INPUT",
) -> WardRiskResponse:
    risk = heat_health_risk(
        temp_c=temperature_c,
        elderly_pct=ward["elderly_pct"],
        outdoor_worker_pct=ward["outdoor_worker_pct"],
        informal_housing_pct=ward["informal_housing_pct"],
        comorbidity_proxy=ward["comorbidity_proxy"],
    )
    dashboard = dashboard_risk(risk["risk_index"])
    return WardRiskResponse(
        ward_id=ward.get("ward_code", ward["ward_id"]),
        ward_name=ward["ward_name"],
        temperature_c=risk["temperature_c"],
        relative_risk=risk["relative_risk"],
        vulnerability_index=risk["vulnerability_index"],
        risk_index=risk["risk_index"],
        risk_category=classify_risk(risk["risk_index"]),
        alert_level=str(dashboard["alert_level"]),
        heat_index_c=compute_heat_index_c(temperature_c, humidity_pct),
        simplified_wbgt_c=compute_simplified_wbgt_c(temperature_c, humidity_pct, wind_speed_ms),
        is_placeholder=bool(ward["is_placeholder"]),
        data_source=data_source,
    )


def _serialize_forecast(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "ward_id": row["ward_code"],
        "ward_name": row["ward_name"],
        "population": row.get("population"),
        "population_2011": row.get("population_2011"),
        "population_source_year": row.get("population_source_year"),
        "population_estimate_year": row.get("population_estimate_year"),
        "population_is_projected": bool(row.get("population_is_projected", False)),
        "population_confidence": row.get("population_confidence"),
        "population_source": row.get("population_source"),
        "expected_excess_deaths": _estimate_excess_deaths(row),
        "target_date": row["target_date"],
        "issued_at": row["issued_at"],
        "lead_days": row["lead_days"],
        "mri": row["mri"],
        "risk_level": row["map_risk_level"],
        "alert_level": row["alert_level"],
        "map_risk_level": row["map_risk_level"],
        "score": row["score"],
        "risk_category": row["risk_category"],
        "temperature_c": row["temp_c"],
        "humidity_pct": row["rh_pct"],
        "wind_speed_ms": row["wind_ms"],
        "solar_wm2": row["solar_wm2"],
        "heat_index_c": row["heat_index_c"],
        "simplified_wbgt_c": row["simplified_wbgt_c"],
        "relative_risk": row["relative_risk"],
        "vulnerability_index": row["vulnerability_index"],
        "elderly_pct": row["elderly_pct"],
        "outdoor_worker_pct": row["outdoor_worker_pct"],
        "informal_housing_pct": row["informal_housing_pct"],
        "comorbidity_proxy": row["comorbidity_proxy"],
        "is_placeholder": bool(row["is_placeholder"]),
        "is_simulated": bool(row["is_simulated"]),
        "is_current": bool(row.get("is_current", False)),
        "observed_at": row.get("observed_at", row.get("weather_time")),
        "data_source": row["weather_source"],
    }


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "HeatKshetra API", "version": app.version, "docs": "/docs", "status": "running"}


@app.get("/health")
def health_check() -> dict[str, Any]:
    source = LIVE_WEATHER_SOURCE if _live_mode() else "SIMULATED_DEMO"
    observation_filter = "is_forecast = 0" if _live_mode() else "is_forecast = 1"
    with connect_db() as connection:
        latest = connection.execute(
            f"SELECT MAX(ts) FROM weather_obs WHERE source = ? AND {observation_filter}",
            (source,),
        ).fetchone()[0]
        population = connection.execute(
            "SELECT MAX(population_estimate_year), MAX(population_updated_at) FROM wards"
        ).fetchone()
    return {
        "status": "healthy",
        "database": "connected",
        "ward_count": table_count("wards"),
        "data_mode": "live" if _live_mode() else "simulated",
        "weather_source": source,
        "weather_updated_at": latest,
        "weather_available": latest is not None,
        "population_estimate_year": population[0],
        "population_updated_at": population[1],
    }


@app.get("/wards", response_model=list[Ward])
def list_wards() -> list[dict[str, Any]]:
    with connect_db() as connection:
        rows = connection.execute(
            """
            SELECT ward_code AS ward_id, ward_name, elderly_pct, outdoor_worker_pct,
                   informal_housing_pct, comorbidity_proxy, is_placeholder, source,
                   population, population_2011, population_source_year,
                   population_estimate_year, population_is_projected,
                   population_confidence, population_source
            FROM wards ORDER BY ward_code
            """
        ).fetchall()
    return [dict(row) | {"is_placeholder": bool(row["is_placeholder"])} for row in rows]


@app.get("/wards/geojson")
def wards_geojson(day: int = Query(default=0, ge=0, le=4)) -> dict[str, Any]:
    target_date = _today() + timedelta(days=day)
    current_conditions = _live_mode() and day == 0
    rows = _current_weather_rows() if current_conditions else _forecast_rows(target_date)
    features = []
    for row in rows:
        if not row["geometry_geojson"]:
            continue
        features.append(
            {
                "type": "Feature",
                "id": row["ward_code"],
                "geometry": json.loads(row["geometry_geojson"]),
                "properties": _serialize_forecast(row) | {"name": row["ward_name"]},
            }
        )
    updated_at = max((row["weather_time"] for row in rows), default=None)
    return {
        "type": "FeatureCollection",
        "features": features,
        "data_source": rows[0]["weather_source"] if rows else (LIVE_WEATHER_SOURCE if _live_mode() else "SIMULATED_DEMO"),
        "is_simulated": not _live_mode(),
        "is_current": current_conditions,
        "updated_at": updated_at,
        "is_stale": _weather_is_stale(updated_at) if current_conditions else False,
        "error": "Live weather is unavailable. Check the backend internet connection and try again."
        if current_conditions and not rows else None,
        "target_date": target_date.isoformat(),
    }


def _weather_is_stale(timestamp: str | None) -> bool:
    if not timestamp:
        return True
    try:
        updated = datetime.fromisoformat(timestamp)
    except ValueError:
        return True
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=INDIA_TZ)
    return datetime.now(INDIA_TZ) - updated.astimezone(INDIA_TZ) > timedelta(hours=1)


@app.get("/ward/{ward_id}/mri", response_model=WardRiskResponse)
def get_ward_mri(
    ward_id: str,
    temperature_c: float = Query(default=40.0, description="Air temperature in Celsius"),
    humidity_pct: float = Query(default=60.0, ge=0, le=100),
    wind_speed_ms: float = Query(default=1.0, ge=0),
) -> WardRiskResponse:
    return _calculate_ward_risk(
        _ward_row(ward_id), temperature_c, humidity_pct, wind_speed_ms,
        "OPEN_METEO_INPUT" if _live_mode() else "SIMULATED_DEMO",
    )


@app.get("/city/mri", response_model=CityRiskResponse)
def get_city_mri(
    temperature_c: float = Query(default=40.0),
    humidity_pct: float = Query(default=60.0, ge=0, le=100),
    wind_speed_ms: float = Query(default=1.0, ge=0),
) -> CityRiskResponse:
    results = [_calculate_ward_risk(ward, temperature_c, humidity_pct, wind_speed_ms) for ward in list_wards()]
    results.sort(key=lambda result: result.risk_index, reverse=True)
    return CityRiskResponse(total_wards=len(results), results=results)


@app.get("/forecast")
def ward_forecast(
    ward_id: str = Query(min_length=1),
    days: int = Query(default=5, ge=1, le=5),
) -> dict[str, Any]:
    ward = _ward_row(ward_id)
    results = []
    for day in range(days):
        results.extend(row for row in _forecast_rows(_today() + timedelta(days=day)) if row["ward_code"] == ward["ward_code"])
    return {
        "ward_id": ward["ward_code"],
        "ward_name": ward["ward_name"],
        "data_source": LIVE_WEATHER_SOURCE if _live_mode() else "SIMULATED_DEMO",
        "is_simulated": not _live_mode(),
        "forecasts": [_serialize_forecast(row) for row in results],
    }


@app.get("/forecast/city")
def city_forecast(days: int = Query(default=5, ge=1, le=5)) -> dict[str, Any]:
    forecasts = []
    for day in range(days):
        target_date = _today() + timedelta(days=day)
        rows = _forecast_rows(target_date)
        if not rows:
            continue
        highest = max(rows, key=lambda row: row["score"])
        counts = {level: sum(row["alert_level"] == level for row in rows) for level in RISK_LEVELS}
        forecasts.append(
            {
                "target_date": target_date.isoformat(),
                "lead_days": day + 1,
                "max_temperature_c": max(row["temp_c"] for row in rows),
                "max_heat_index_c": max(row["heat_index_c"] for row in rows),
                "risk_level": highest["alert_level"],
                "map_risk_level": highest["map_risk_level"],
                "score": highest["score"],
                "highest_ward_id": highest["ward_code"],
                "highest_ward_name": highest["ward_name"],
                "ward_count": len(rows),
                "risk_counts": counts,
                "top_wards": [_serialize_forecast(row) for row in sorted(rows, key=lambda item: item["score"], reverse=True)[:5]],
            }
        )
    return {
        "data_source": LIVE_WEATHER_SOURCE if _live_mode() else "SIMULATED_DEMO",
        "is_simulated": not _live_mode(),
        "forecasts": forecasts,
    }


@app.get("/weather/{ward_id}")
def ward_weather(ward_id: str, days: int = Query(default=5, ge=1, le=5)) -> dict[str, Any]:
    ward = _ward_row(ward_id)
    results = []
    for day in range(days):
        target_date = _today() + timedelta(days=day)
        row = next((item for item in _forecast_rows(target_date) if item["ward_code"] == ward["ward_code"]), None)
        if row:
            results.append(
                {
                    "date": row["target_date"],
                    "temperature_c": row["temp_c"],
                    "humidity_pct": row["rh_pct"],
                    "wind_speed_ms": row["wind_ms"],
                    "solar_wm2": row["solar_wm2"],
                    "heat_index_c": row["heat_index_c"],
                    "simplified_wbgt_c": row["simplified_wbgt_c"],
                    "source": row["weather_source"],
                    "is_forecast": True,
                }
            )
    return {
        "ward_id": ward["ward_code"],
        "ward_name": ward["ward_name"],
        "data_source": LIVE_WEATHER_SOURCE if _live_mode() else "SIMULATED_DEMO",
        "is_simulated": not _live_mode(),
        "observations": results,
    }


@app.get("/advisories/{risk_level}")
def get_advisory(risk_level: str) -> dict[str, Any]:
    key = UI_TO_ALERT_LEVEL.get(risk_level.upper(), risk_level.upper())
    if key not in ADVISORIES:
        raise HTTPException(status_code=404, detail="Unknown risk level.")
    return {"risk_level": key, **ADVISORIES[key], "data_source": "PUBLIC_HEALTH_GUIDANCE_DEMO"}


@app.get("/action-plan/{risk_level}")
def get_action_plan(risk_level: str) -> dict[str, Any]:
    key = UI_TO_ALERT_LEVEL.get(risk_level.upper(), risk_level.upper())
    if key not in ACTION_PLANS:
        raise HTTPException(status_code=404, detail="Unknown risk level.")
    return {"risk_level": key, "actions": ACTION_PLANS[key], "data_source": "DEMO_ACTION_PLAN"}


@app.post("/subscribe", status_code=201)
def subscribe(payload: SubscribeRequest) -> dict[str, Any]:
    if not payload.consent:
        raise HTTPException(status_code=422, detail="Explicit consent is required before subscribing.")
    ward = _ward_row(payload.ward_id)
    with connect_db() as connection:
        cursor = connection.execute(
            """
            INSERT INTO subscribers (phone, channel, ward_id, language, consent)
            VALUES (?, ?, ?, ?, 1)
            """,
            (payload.phone.strip(), payload.channel, ward["ward_id"], payload.language),
        )
    return {"status": "subscribed", "subscriber_id": cursor.lastrowid, "ward_id": ward["ward_code"], "channel": payload.channel}


def _require_twilio_configuration(channel: str) -> tuple[str, str, str]:
    sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    sms_from = os.getenv("TWILIO_FROM_NUMBER", "").strip()
    whatsapp_from = os.getenv("TWILIO_WHATSAPP_FROM", "").strip()
    if not sid or not token or (channel == "SMS" and not sms_from) or (channel == "WHATSAPP" and not whatsapp_from):
        raise HTTPException(status_code=503, detail="Twilio credentials for the requested channel are not configured.")
    return sid, token, sms_from if channel == "SMS" else whatsapp_from


def _send_twilio_message(channel: str, phone: str, message: str) -> None:
    sid, token, from_number = _require_twilio_configuration(channel)
    to_number = phone if channel == "SMS" else (phone if phone.startswith("whatsapp:") else f"whatsapp:{phone}")
    body = urllib.parse.urlencode({"From": from_number, "To": to_number, "Body": message}).encode()
    auth = base64.b64encode(f"{sid}:{token}".encode()).decode()
    request = urllib.request.Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
        data=body,
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            if response.status >= 300:
                raise RuntimeError(f"Twilio returned HTTP {response.status}.")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
        raise RuntimeError(f"Twilio send failed: {type(error).__name__}") from error


@app.post("/alerts/trigger")
def trigger_alerts(
    payload: AlertTriggerRequest,
    x_admin_key: str | None = Header(default=None, alias="X-Admin-Key"),
) -> dict[str, Any]:
    admin_key = os.getenv("ADMIN_API_KEY", "").strip()
    if not admin_key or not x_admin_key or not secrets.compare_digest(x_admin_key, admin_key):
        raise HTTPException(status_code=401, detail="A valid X-Admin-Key is required for live alerts.")

    threshold = RISK_LEVEL_ORDER[payload.risk_level]
    selected_codes = set(payload.ward_ids or [])
    eligible = [
        row for row in _forecast_rows(_today())
        if RISK_LEVEL_ORDER[row["alert_level"]] >= threshold
        and (not selected_codes or row["ward_code"] in selected_codes)
    ]
    ward_subscribers: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    for ward in eligible:
        with connect_db() as connection:
            subscribers = connection.execute(
                """
                SELECT id, phone, channel FROM subscribers
                WHERE ward_id = ? AND consent = 1
                ORDER BY channel, id
                """,
                (ward["ward_id"],),
            ).fetchall()
        ward_subscribers.append((ward, [dict(subscriber) for subscriber in subscribers]))

    # Check every channel before sending anything, so a missing WhatsApp setting
    # cannot leave an alert only partially delivered after SMS has gone out.
    channels = {subscriber["channel"] for _, subscribers in ward_subscribers for subscriber in subscribers}
    for channel in channels:
        _require_twilio_configuration(channel)

    sent_groups = []
    recipient_count = 0
    for ward, subscribers in ward_subscribers:
        message = (
            f"HeatKshetra {ward['alert_level']} heat alert for {ward['ward_name']}. "
            "Drink water, avoid strenuous outdoor activity from noon to 4 PM, and check on neighbours."
        )
        grouped: dict[str, list[dict[str, Any]]] = {"SMS": [], "WHATSAPP": []}
        for subscriber in subscribers:
            grouped[subscriber["channel"]].append(subscriber)
        for channel, recipients in grouped.items():
            if not recipients:
                continue
            successful = 0
            status = "SENT"
            for recipient in recipients:
                try:
                    _send_twilio_message(channel, recipient["phone"], message)
                    successful += 1
                except (HTTPException, RuntimeError):
                    status = "FAILED"
            if 0 < successful < len(recipients):
                status = "PARTIAL"
            with connect_db() as connection:
                connection.execute(
                    """
                    INSERT INTO alerts_log (ward_id, risk_level, channel, recipients, message, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (ward["ward_id"], ward["alert_level"], channel, successful, message, status),
                )
            recipient_count += successful
            sent_groups.append({"ward_id": ward["ward_code"], "channel": channel, "recipients": successful, "status": status})

    has_delivery_failures = any(group["status"] != "SENT" for group in sent_groups)
    return {
        "delivery_mode": "live",
        "threshold": payload.risk_level,
        "eligible_wards": len(eligible),
        "recipient_count": recipient_count,
        "groups": sent_groups,
        "message": (
            "No eligible wards met the threshold."
            if not eligible
            else "No consented subscribers are registered for eligible wards."
            if not channels
            else "Some live alert messages could not be delivered."
            if has_delivery_failures
            else "Live alert delivery completed."
        ),
    }


@app.post("/alerts/demo-sms")
def send_extreme_risk_demo_sms(
    payload: SmsDemoRequest,
    x_admin_key: str | None = Header(default=None, alias="X-Admin-Key"),
) -> dict[str, Any]:
    """Send one clearly labeled RED/extreme-risk demo SMS to an opted-in number."""
    admin_key = os.getenv("ADMIN_API_KEY", "").strip()
    if not admin_key or not x_admin_key or not secrets.compare_digest(x_admin_key, admin_key):
        raise HTTPException(status_code=401, detail="A valid X-Admin-Key is required for live alerts.")

    phone = payload.phone.strip()
    with connect_db() as connection:
        subscriber = connection.execute(
            """
            SELECT s.phone, w.ward_id, w.ward_code, w.ward_name
            FROM subscribers s JOIN wards w ON w.ward_id = s.ward_id
            WHERE s.phone = ? AND s.channel = 'SMS' AND s.consent = 1
            ORDER BY s.id DESC LIMIT 1
            """,
            (phone,),
        ).fetchone()
    if not subscriber:
        raise HTTPException(
            status_code=404,
            detail="No opted-in SMS subscription was found for this number. Subscribe it to a ward first.",
        )

    _require_twilio_configuration("SMS")
    message = (
        f"HeatKshetra EXTREME heat alert DEMO for {subscriber['ward_name']}. "
        "This is a test, not a live emergency. Alert copy: avoid outdoor activity, move to a cool or shaded place, "
        "drink water, and check on neighbours."
    )
    try:
        _send_twilio_message("SMS", subscriber["phone"], message)
    except RuntimeError as error:
        with connect_db() as connection:
            connection.execute(
                "INSERT INTO alerts_log (ward_id, risk_level, channel, recipients, message, status) VALUES (?, 'RED', 'SMS', 0, ?, 'FAILED')",
                (subscriber["ward_id"], message),
            )
        raise HTTPException(status_code=502, detail="Twilio could not deliver the demo SMS.") from error

    with connect_db() as connection:
        connection.execute(
            "INSERT INTO alerts_log (ward_id, risk_level, channel, recipients, message, status) VALUES (?, 'RED', 'SMS', 1, ?, 'SENT')",
            (subscriber["ward_id"], message),
        )
    return {
        "status": "SENT",
        "risk_level": "RED",
        "channel": "SMS",
        "ward_id": subscriber["ward_code"],
        "recipients": 1,
        "message": "One real demo SMS was accepted by Twilio.",
    }


def _firebase_messaging():
    """Return Firebase Admin messaging, initializing it from server-only credentials."""
    project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip()
    credential_file = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not project_id or not credential_file:
        raise HTTPException(
            status_code=503,
            detail="Firebase push is not configured. Set FIREBASE_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS on the backend.",
        )
    try:
        import firebase_admin
        from firebase_admin import credentials, messaging

        try:
            firebase_admin.get_app()
        except ValueError:
            firebase_admin.initialize_app(
                credentials.Certificate(credential_file),
                {"projectId": project_id},
            )
        return messaging
    except HTTPException:
        raise
    except Exception as error:
        LOGGER.exception("Firebase Admin SDK initialization failed.")
        raise HTTPException(status_code=503, detail="Firebase Admin SDK could not initialize; check backend credentials and project ID.") from error


@app.post("/push/subscribe", status_code=201)
def subscribe_for_push(payload: PushSubscriptionRequest) -> dict[str, Any]:
    """Store this browser's FCM token after explicit push-notification consent."""
    if not payload.consent:
        raise HTTPException(status_code=422, detail="Explicit consent is required before enabling push notifications.")
    ward = _ward_row(payload.ward_id)
    with connect_db() as connection:
        connection.execute(
            """
            INSERT INTO push_subscriptions (token, ward_id, consent, enabled)
            VALUES (?, ?, 1, 1)
            ON CONFLICT(token) DO UPDATE SET
                ward_id = excluded.ward_id,
                consent = 1,
                enabled = 1,
                updated_at = CURRENT_TIMESTAMP
            """,
            (payload.token, ward["ward_id"]),
        )
        subscription = connection.execute(
            "SELECT id FROM push_subscriptions WHERE token = ?",
            (payload.token,),
        ).fetchone()
    return {"status": "subscribed", "subscription_id": subscription["id"], "ward_id": ward["ward_code"]}


@app.post("/alerts/demo-push")
def send_extreme_risk_demo_push(
    payload: PushDemoRequest,
    x_admin_key: str | None = Header(default=None, alias="X-Admin-Key"),
) -> dict[str, Any]:
    """Send one clearly marked RED/extreme-risk demo push to the opted-in browser."""
    admin_key = os.getenv("ADMIN_API_KEY", "").strip()
    if not admin_key or not x_admin_key or not secrets.compare_digest(x_admin_key, admin_key):
        raise HTTPException(status_code=401, detail="A valid X-Admin-Key is required for live alerts.")

    with connect_db() as connection:
        subscription = connection.execute(
            """
            SELECT p.id, p.token, p.ward_id, w.ward_code, w.ward_name
            FROM push_subscriptions p JOIN wards w ON w.ward_id = p.ward_id
            WHERE p.id = ? AND p.enabled = 1 AND p.consent = 1
            """,
            (payload.subscription_id,),
        ).fetchone()
    if not subscription:
        raise HTTPException(status_code=404, detail="No enabled, consented browser push subscription was found.")

    messaging = _firebase_messaging()
    message = (
        f"HeatKshetra EXTREME heat alert DEMO for {subscription['ward_name']}. "
        "This is a test, not a live emergency. Avoid outdoor activity, move to a cool or shaded place, drink water, and check on neighbours."
    )
    firebase_message = messaging.Message(
        notification=messaging.Notification(
            title="HeatKshetra · EXTREME RISK DEMO",
            body=message,
        ),
        data={
            "risk_level": "RED",
            "demo": "true",
            "ward_id": subscription["ward_code"],
            "link": "/?risk-preview=extreme#city-actions",
        },
        token=subscription["token"],
        webpush=messaging.WebpushConfig(
            notification=messaging.WebpushNotification(
                icon="/favicon.ico",
                badge="/favicon.ico",
                tag="heatkshetra-extreme-demo",
            ),
        ),
    )
    try:
        messaging.send(firebase_message)
    except Exception as error:
        LOGGER.exception("Firebase rejected the demo push notification.")
        with connect_db() as connection:
            connection.execute(
                "INSERT INTO push_delivery_log (ward_id, risk_level, recipients, message, status) VALUES (?, 'RED', 0, ?, 'FAILED')",
                (subscription["ward_id"], message),
            )
        raise HTTPException(status_code=502, detail="Firebase did not accept the demo push. Check the Firebase project, API and browser token.") from error

    with connect_db() as connection:
        connection.execute(
            "INSERT INTO push_delivery_log (ward_id, risk_level, recipients, message, status) VALUES (?, 'RED', 1, ?, 'ACCEPTED')",
            (subscription["ward_id"], message),
        )
    return {
        "status": "ACCEPTED",
        "risk_level": "RED",
        "channel": "PUSH",
        "ward_id": subscription["ward_code"],
        "recipients": 1,
        "message": "Firebase accepted one real demo push for delivery to the opted-in browser.",
    }


@app.get("/alerts/log")
def alert_log(limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
    with connect_db() as connection:
        rows = connection.execute(
            """
            SELECT a.id, w.ward_code AS ward_id, a.risk_level, a.channel,
                   a.recipients, a.message, a.sent_at, a.status
            FROM alerts_log a LEFT JOIN wards w ON w.ward_id = a.ward_id
            UNION ALL
            SELECT 1000000000 + p.id AS id, w.ward_code AS ward_id, p.risk_level,
                   'PUSH' AS channel, p.recipients, p.message, p.sent_at, p.status
            FROM push_delivery_log p LEFT JOIN wards w ON w.ward_id = p.ward_id
            ORDER BY sent_at DESC, id DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return {"items": [dict(row) for row in rows]}
