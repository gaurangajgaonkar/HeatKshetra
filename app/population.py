"""Census-based ward population projection using Greater Mumbai's census CAGR."""

from __future__ import annotations

import csv
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.database import connect_db


ROOT = Path(__file__).resolve().parents[1]
WARD_CENSUS_FILE = ROOT / "app" / "data" / "ward_population_census.csv"
CITY_CENSUS_FILE = ROOT / "app" / "data" / "greater_mumbai_census_totals.csv"
INDIA_TZ = timezone(timedelta(hours=5, minutes=30))
CRUDE_DEATH_RATE_PER_1000_PER_YEAR = 7.0  # Approximation inherited from the source project.


def annual_growth_rate(city_rows: list[dict[str, str]], target_year: int) -> float:
    """Derive CAGR from the two latest Greater Mumbai census totals available."""
    eligible = sorted(
        (int(row["census_year"]), int(row["total_population"]))
        for row in city_rows
        if int(row["census_year"]) <= target_year
    )
    if len(eligible) < 2:
        raise ValueError("At least two Greater Mumbai census totals are required to calculate CAGR.")
    (start_year, start_population), (end_year, end_population) = eligible[-2:]
    if end_year <= start_year or min(start_population, end_population) <= 0:
        raise ValueError("Census years and populations must be positive and increasing.")
    return (end_population / start_population) ** (1 / (end_year - start_year)) - 1


def refresh_population_projection(target_year: int | None = None) -> dict[str, int | float]:
    """Recalculate all ward populations from CSV, so newly added census rows apply automatically."""
    if target_year is None:
        target_year = datetime.now(INDIA_TZ).year

    with CITY_CENSUS_FILE.open("r", encoding="utf-8-sig", newline="") as source:
        city_rows = list(csv.DictReader(source))
    with WARD_CENSUS_FILE.open("r", encoding="utf-8-sig", newline="") as source:
        ward_rows = list(csv.DictReader(source))
    cagr = annual_growth_rate(city_rows, target_year)

    census_by_ward: dict[str, list[dict[str, str]]] = {}
    for row in ward_rows:
        code = normalize_ward_code(row["ward_code"])
        year = int(row["census_year"])
        population = int(row["population"])
        if not code or year < 1 or population < 0:
            raise ValueError(f"Invalid ward census record: {row!r}")
        census_by_ward.setdefault(code, []).append(row | {"ward_code": code})

    updated_at = datetime.now(INDIA_TZ).replace(microsecond=0).isoformat()
    with connect_db() as connection:
        wards = connection.execute("SELECT ward_id, ward_code FROM wards ORDER BY ward_code").fetchall()
        if not wards:
            raise RuntimeError("No wards are seeded. Import Mumbai ward boundaries first.")
        updates = []
        for ward in wards:
            records = census_by_ward.get(ward["ward_code"], [])
            available = [row for row in records if int(row["census_year"]) <= target_year]
            if not available:
                raise ValueError(f"No census population at or before {target_year} for ward {ward['ward_code']}.")
            latest = max(available, key=lambda row: int(row["census_year"]))
            source_year = int(latest["census_year"])
            census_population = int(latest["population"])
            is_projected = source_year < target_year
            projected_population = round(census_population * (1 + cagr) ** (target_year - source_year))
            official = latest["confidence"].strip().lower() == "official"
            confidence = latest["confidence"].strip().lower() or "unspecified"
            source_note = latest.get("source_note", "").strip()
            if is_projected:
                method_note = (
                    f"Projected from ward census {source_year} to {target_year} at "
                    f"Greater Mumbai CAGR {cagr * 100:.4f}% per year (uniform city-wide estimate)."
                )
            else:
                method_note = f"Ward population from census {source_year}; {confidence} confidence."
            population_2011 = next(
                (int(row["population"]) for row in records if int(row["census_year"]) == 2011),
                None,
            )
            # The source project estimates baseline deaths with a crude city-wide
            # mortality rate; keep it explicitly marked as a proxy.
            baseline_daily_deaths = projected_population * (CRUDE_DEATH_RATE_PER_1000_PER_YEAR / 1000) / 365
            population_source = source_note or method_note
            if is_projected:
                population_source = f"{method_note} Source census row: {source_note}".strip()
            updates.append((
                projected_population,
                population_2011,
                source_year,
                target_year,
                int(is_projected),
                "official" if official else confidence,
                population_source,
                baseline_daily_deaths,
                updated_at,
                ward["ward_id"],
            ))
        connection.executemany(
            """
            UPDATE wards SET population = ?, population_2011 = ?, population_source_year = ?,
                population_estimate_year = ?, population_is_projected = ?, population_confidence = ?,
                population_source = ?, baseline_daily_deaths = ?, population_updated_at = ?
            WHERE ward_id = ?
            """,
            updates,
        )
    return {"ward_count": len(updates), "target_year": target_year, "annual_growth_rate": cagr}


def normalize_ward_code(code: str) -> str:
    return "".join(character for character in code.upper().strip() if character.isalnum())
