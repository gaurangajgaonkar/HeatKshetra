"""Generate clearly labelled, deterministic weather forecasts for the demo."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.database import connect_db
from app.exposure import compute_heat_index_c, compute_simplified_wbgt_c
from app.heat_risk import heat_health_risk
from app.risk_levels import dashboard_risk


DEMO_SOURCE = "SIMULATED_DEMO"
INDIA_TZ = timezone(timedelta(hours=5, minutes=30))
DAY_TEMPERATURE_SHIFT = (0.0, 0.3, 0.6, 0.1, -0.5)


def refresh_demo_forecasts() -> None:
    now = datetime.now(INDIA_TZ).replace(microsecond=0)
    issued_at = now.isoformat()
    start_date = now.date()

    with connect_db() as connection:
        wards = connection.execute("SELECT * FROM wards ORDER BY ward_code").fetchall()
        if not wards:
            raise RuntimeError("No wards are seeded. Import the Mumbai GeoJSON first.")

        connection.execute("DELETE FROM risk_forecast WHERE is_simulated = 1")
        connection.execute("DELETE FROM weather_obs WHERE source = ? AND is_forecast = 1", (DEMO_SOURCE,))
        connection.execute("DELETE FROM thermal_indices WHERE source = ? AND is_simulated = 1", (DEMO_SOURCE,))

        for index, ward in enumerate(wards):
            # These weather values are deliberately synthetic and stable across restarts.
            for lead_days, temp_shift in enumerate(DAY_TEMPERATURE_SHIFT, start=1):
                target = start_date + timedelta(days=lead_days - 1)
                temp_c = round(34.0 + ((index * 7) % 13) / 10 + temp_shift, 2)
                rh_pct = float(50 + ((index * 11) % 15))
                wind_ms = round(1.1 + ((index * 3) % 17) / 10, 2)
                solar_wm2 = float(440 + ((index * 73) % 460))
                observed_at = datetime.combine(target, datetime.min.time(), tzinfo=INDIA_TZ).replace(hour=12)
                ts = observed_at.isoformat()

                connection.execute(
                    """
                    INSERT INTO weather_obs (
                        ward_id, ts, temp_c, rh_pct, wind_ms, solar_wm2,
                        source, is_forecast
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                    """,
                    (ward["ward_id"], ts, temp_c, rh_pct, wind_ms, solar_wm2, DEMO_SOURCE),
                )

                heat_index = compute_heat_index_c(temp_c, rh_pct)
                wbgt = compute_simplified_wbgt_c(temp_c, rh_pct, wind_ms)
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
                    INSERT INTO thermal_indices (
                        ward_id, ts, wbgt, utci, heat_index, source, is_simulated
                    ) VALUES (?, ?, ?, NULL, ?, ?, 1)
                    """,
                    (ward["ward_id"], ts, wbgt, heat_index, DEMO_SOURCE),
                )
                connection.execute(
                    """
                    INSERT INTO risk_forecast (
                        ward_id, target_date, issued_at, lead_days, mri,
                        risk_level, expected_excess_deaths, is_simulated
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                    """,
                    (
                        ward["ward_id"],
                        target.isoformat(),
                        issued_at,
                        lead_days,
                        risk["risk_index"],
                        dashboard["alert_level"],
                        round(max(0.0, (ward["baseline_daily_deaths"] or 0.0) * (risk["risk_index"] - 1)), 1),
                    ),
                )
