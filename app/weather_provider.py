"""Fetch current conditions and short-range forecasts from Open-Meteo."""

from __future__ import annotations

import json
import logging
import math
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.database import connect_db
from app.exposure import compute_heat_index_c, compute_simplified_wbgt_c
from app.heat_risk import heat_health_risk
from app.risk_levels import dashboard_risk


LOGGER = logging.getLogger(__name__)
SOURCE = "OPEN_METEO"
INDIA_TZ = timezone(timedelta(hours=5, minutes=30))
API_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_FIELDS = ("temperature_2m", "relative_humidity_2m", "wind_speed_10m", "shortwave_radiation")


def refresh_live_weather() -> int:
    """Refresh cached ward conditions and daily noon forecasts as one batch."""
    with connect_db() as connection:
        wards = [dict(row) for row in connection.execute("SELECT * FROM wards ORDER BY ward_code")]
    if not wards:
        raise RuntimeError("No wards are seeded. Import the Mumbai GeoJSON first.")

    coordinates = [_geometry_center(json.loads(ward["geometry_geojson"])) for ward in wards]
    query = urllib.parse.urlencode(
        {
            "latitude": ",".join(f"{lat:.5f}" for lat, _ in coordinates),
            "longitude": ",".join(f"{lng:.5f}" for _, lng in coordinates),
            "current": ",".join(WEATHER_FIELDS),
            "hourly": ",".join(WEATHER_FIELDS),
            "forecast_days": "5",
            "timezone": "Asia/Kolkata",
            "temperature_unit": "celsius",
            "wind_speed_unit": "ms",
        }
    )
    request = urllib.request.Request(
        f"{API_URL}?{query}",
        headers={"Accept": "application/json", "User-Agent": "HeatKshetra/1.0 (weather dashboard)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            payload = json.loads(response.read())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Open-Meteo request failed ({type(error).__name__}).") from error

    locations = payload if isinstance(payload, list) else [payload]
    if len(locations) != len(wards):
        raise RuntimeError(
            f"Open-Meteo returned {len(locations)} locations for {len(wards)} Mumbai wards."
        )
    issued_at = datetime.now(INDIA_TZ).replace(microsecond=0).isoformat()
    today = datetime.now(INDIA_TZ).date()
    rows: list[dict[str, Any]] = []
    for ward, location in zip(wards, locations, strict=True):
        current = location.get("current") or {}
        current_time = _local_timestamp(current.get("time"))
        current_values = _read_values(current)
        if current_time is None or current_values is None:
            raise RuntimeError(f"Open-Meteo omitted current weather for ward {ward['ward_code']}.")
        rows.append(
            {
                "ward": ward,
                "timestamp": current_time,
                "values": current_values,
                "target_date": today,
                "is_forecast": 0,
                "lead_days": 1,
                "issued_at": issued_at,
            }
        )

        hourly = location.get("hourly") or {}
        hourly_times = hourly.get("time") or []
        time_indices = {value: index for index, value in enumerate(hourly_times)}
        for lead_days in range(1, 6):
            target = today + timedelta(days=lead_days - 1)
            noon_index = time_indices.get(f"{target.isoformat()}T12:00")
            if noon_index is None:
                raise RuntimeError(
                    f"Open-Meteo omitted the 12:00 IST forecast for {target.isoformat()} "
                    f"in ward {ward['ward_code']}."
                )
            values = _read_values({
                field: (hourly.get(field) or [])[noon_index]
                if noon_index < len(hourly.get(field) or []) else None
                for field in WEATHER_FIELDS
            })
            if values is None:
                raise RuntimeError(f"Open-Meteo returned incomplete forecast data for ward {ward['ward_code']}.")
            rows.append(
                {
                    "ward": ward,
                    "timestamp": _local_timestamp(f"{target.isoformat()}T12:00"),
                    "values": values,
                    "target_date": target,
                    "is_forecast": 1,
                    "lead_days": lead_days,
                    "issued_at": issued_at,
                }
            )

    with connect_db() as connection:
        # Replace both demo data and this provider's prior cache only after the
        # new response has been validated completely.
        connection.execute("DELETE FROM risk_forecast")
        connection.execute("DELETE FROM weather_obs WHERE source IN ('SIMULATED_DEMO', ?)", (SOURCE,))
        connection.execute("DELETE FROM thermal_indices WHERE source IN ('SIMULATED_DEMO', ?)", (SOURCE,))
        for row in rows:
            ward = row["ward"]
            values = row["values"]
            temp_c, rh_pct, wind_ms, solar_wm2 = values
            wbgt = compute_simplified_wbgt_c(temp_c, rh_pct, wind_ms)
            heat_index = compute_heat_index_c(temp_c, rh_pct)
            risk = heat_health_risk(
                temp_c=temp_c,
                elderly_pct=ward["elderly_pct"],
                outdoor_worker_pct=ward["outdoor_worker_pct"],
                informal_housing_pct=ward["informal_housing_pct"],
                comorbidity_proxy=ward["comorbidity_proxy"],
            )
            dashboard = dashboard_risk(risk["risk_index"])
            connection.execute(
                """
                INSERT INTO weather_obs (
                    ward_id, ts, temp_c, rh_pct, wind_ms, solar_wm2, source, is_forecast
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ward["ward_id"], row["timestamp"], temp_c, rh_pct, wind_ms,
                    solar_wm2, SOURCE, row["is_forecast"],
                ),
            )
            connection.execute(
                """
                INSERT INTO thermal_indices (
                    ward_id, ts, wbgt, utci, heat_index, source, is_simulated
                ) VALUES (?, ?, ?, NULL, ?, ?, 0)
                """,
                (ward["ward_id"], row["timestamp"], wbgt, heat_index, SOURCE),
            )
            if row["is_forecast"]:
                connection.execute(
                    """
                    INSERT INTO risk_forecast (
                        ward_id, target_date, issued_at, lead_days, mri,
                        risk_level, expected_excess_deaths, is_simulated
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                    """,
                    (
                        ward["ward_id"], row["target_date"].isoformat(), row["issued_at"],
                        row["lead_days"], risk["risk_index"], dashboard["alert_level"],
                        round(max(0.0, (ward.get("baseline_daily_deaths") or 0.0) * (risk["risk_index"] - 1)), 1),
                    ),
                )
    LOGGER.info("Refreshed live Open-Meteo weather for %d Mumbai wards.", len(wards))
    return len(wards)


def _read_values(source: dict[str, Any]) -> tuple[float, float, float, float] | None:
    values = [source.get(field) for field in WEATHER_FIELDS]
    if any(value is None for value in values[:3]):
        return None
    try:
        temp_c, rh_pct, wind_ms = (float(value) for value in values[:3])
        solar_wm2 = 0.0 if values[3] is None else float(values[3])
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(value) for value in (temp_c, rh_pct, wind_ms, solar_wm2)):
        return None
    if not 0 <= rh_pct <= 100 or wind_ms < 0 or solar_wm2 < 0:
        return None
    return temp_c, rh_pct, wind_ms, solar_wm2


def _local_timestamp(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=INDIA_TZ)
    else:
        parsed = parsed.astimezone(INDIA_TZ)
    return parsed.replace(second=0, microsecond=0).isoformat()


def _geometry_center(geometry: dict[str, Any]) -> tuple[float, float]:
    """Return an area-weighted centroid for a GeoJSON Polygon/MultiPolygon."""
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    polygons = [coordinates] if kind == "Polygon" else coordinates if kind == "MultiPolygon" else None
    if not polygons:
        raise ValueError(f"Unsupported or empty ward geometry: {kind!r}.")

    weighted_lng = weighted_lat = total_area = 0.0
    for polygon in polygons:
        if not polygon or not polygon[0]:
            continue
        ring = polygon[0]
        twice_area = 0.0
        centroid_lng = centroid_lat = 0.0
        for (lng_a, lat_a), (lng_b, lat_b) in zip(ring, ring[1:] + ring[:1]):
            cross = lng_a * lat_b - lng_b * lat_a
            twice_area += cross
            centroid_lng += (lng_a + lng_b) * cross
            centroid_lat += (lat_a + lat_b) * cross
        if abs(twice_area) < 1e-12:
            continue
        signed_area = twice_area / 2
        area = abs(signed_area)
        weighted_lng += centroid_lng / (3 * twice_area) * area
        weighted_lat += centroid_lat / (3 * twice_area) * area
        total_area += area
    if total_area == 0:
        raise ValueError("Could not calculate a centroid for a Mumbai ward polygon.")
    return weighted_lat / total_area, weighted_lng / total_area
