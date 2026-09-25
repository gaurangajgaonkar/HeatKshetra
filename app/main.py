"""
FastAPI application for the Heat-Health Risk Index.

Run with:

    uvicorn app.main:app --reload
"""

import csv
from pathlib import Path
from typing import Dict, List

from fastapi import FastAPI, HTTPException, Query

from app.exposure import (
    compute_heat_index_c,
    compute_simplified_wbgt_c,
)
from app.heat-risk import (
    classify_risk,
    heat_health_risk,
)
from app.schemas import (
    CityRiskResponse,
    Ward,
    WardRiskResponse,
)


app = FastAPI(
    title="Heat-Health Risk API",
    description=(
        "Backend API for a geographically resolved "
        "heat-health risk index."
    ),
    version="1.0.0",
)


DATA_FILE = (
    Path(__file__).resolve().parent
    / "data"
    / "wards_demographics.csv"
)


def load_wards() -> List[Dict]:
    """Load ward demographic data from CSV."""

    if not DATA_FILE.exists():
        raise FileNotFoundError(
            f"Ward data file not found: {DATA_FILE}"
        )

    with open(DATA_FILE, "r", encoding="utf-8") as file:
        reader = csv.DictReader(file)

        wards = []

        for row in reader:
            wards.append(
                {
                    "ward_id": row["ward_id"],
                    "ward_name": row["ward_name"],
                    "elderly_pct": float(row["elderly_pct"]),
                    "outdoor_worker_pct": float(
                        row["outdoor_worker_pct"]
                    ),
                    "informal_housing_pct": float(
                        row["informal_housing_pct"]
                    ),
                    "comorbidity_proxy": float(
                        row["comorbidity_proxy"]
                    ),
                }
            )

    return wards


def get_ward(ward_id: str) -> Dict:
    """Find a ward by ID."""

    wards = load_wards()

    for ward in wards:
        if ward["ward_id"].lower() == ward_id.lower():
            return ward

    raise HTTPException(
        status_code=404,
        detail=f"Ward '{ward_id}' not found.",
    )


def calculate_ward_risk(
    ward: Dict,
    temperature_c: float,
    humidity_pct: float,
    wind_speed_ms: float,
) -> WardRiskResponse:
    """Calculate all heat-risk metrics for one ward."""

    risk = heat_health_risk(
        temp_c=temperature_c,
        elderly_pct=ward["elderly_pct"],
        outdoor_worker_pct=ward["outdoor_worker_pct"],
        informal_housing_pct=ward["informal_housing_pct"],
        comorbidity_proxy=ward["comorbidity_proxy"],
    )

    heat_index = compute_heat_index_c(
        temp_c=temperature_c,
        rh_pct=humidity_pct,
    )

    wbgt = compute_simplified_wbgt_c(
        temp_c=temperature_c,
        rh_pct=humidity_pct,
        wind_speed_ms=wind_speed_ms,
    )

    return WardRiskResponse(
        ward_id=ward["ward_id"],
        ward_name=ward["ward_name"],
        temperature_c=risk["temperature_c"],
        relative_risk=risk["relative_risk"],
        vulnerability_index=risk["vulnerability_index"],
        risk_index=risk["risk_index"],
        risk_category=classify_risk(risk["risk_index"]),
        heat_index_c=heat_index,
        simplified_wbgt_c=wbgt,
    )


@app.get("/")
def root():
    return {
        "name": "Heat-Health Risk API",
        "version": "1.0.0",
        "docs": "/docs",
        "status": "running",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
    }


@app.get("/wards", response_model=List[Ward])
def list_wards():
    """
    Return all available wards and their demographic variables.
    """

    return load_wards()


@app.get(
    "/ward/{ward_id}/mri",
    response_model=WardRiskResponse,
)
def get_ward_mri(
    ward_id: str,
    temperature_c: float = Query(
        40.0,
        description="Air temperature in Celsius",
    ),
    humidity_pct: float = Query(
        60.0,
        ge=0,
        le=100,
        description="Relative humidity percentage",
    ),
    wind_speed_ms: float = Query(
        1.0,
        ge=0,
        description="Wind speed in metres per second",
    ),
):
    """
    Calculate the heat-health risk for one ward.

    Example:

        /ward/W07/mri?temperature_c=40&humidity_pct=60
    """

    ward = get_ward(ward_id)

    return calculate_ward_risk(
        ward=ward,
        temperature_c=temperature_c,
        humidity_pct=humidity_pct,
        wind_speed_ms=wind_speed_ms,
    )


@app.get(
    "/city/mri",
    response_model=CityRiskResponse,
)
def get_city_mri(
    temperature_c: float = Query(
        40.0,
        description="Air temperature in Celsius",
    ),
    humidity_pct: float = Query(
        60.0,
        ge=0,
        le=100,
        description="Relative humidity percentage",
    ),
    wind_speed_ms: float = Query(
        1.0,
        ge=0,
        description="Wind speed in metres per second",
    ),
):
    """
    Calculate risk for every ward.

    Results are sorted from highest risk to lowest risk.
    """

    wards = load_wards()

    results = []

    for ward in wards:
        result = calculate_ward_risk(
            ward=ward,
            temperature_c=temperature_c,
            humidity_pct=humidity_pct,
            wind_speed_ms=wind_speed_ms,
        )

        results.append(result)

    results.sort(
        key=lambda result: result.risk_index,
        reverse=True,
    )

    return CityRiskResponse(
        total_wards=len(results),
        results=results,
    )
