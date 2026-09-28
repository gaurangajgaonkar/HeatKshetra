"""
Pydantic schemas used by the FastAPI application.
"""

from typing import List

from pydantic import BaseModel, Field


class Ward(BaseModel):
    ward_id: str
    ward_name: str

    elderly_pct: float = Field(ge=0, le=100)
    outdoor_worker_pct: float = Field(ge=0, le=100)
    informal_housing_pct: float = Field(ge=0, le=100)
    comorbidity_proxy: float = Field(ge=0, le=100)


class ExposureRequest(BaseModel):
    temperature_c: float = Field(
        ...,
        description="Air temperature in Celsius",
    )

    relative_humidity_pct: float = Field(
        ...,
        ge=0,
        le=100,
        description="Relative humidity percentage",
    )

    wind_speed_ms: float = Field(
        default=1.0,
        ge=0,
        description="Wind speed in metres per second",
    )


class WardRiskResponse(BaseModel):
    ward_id: str
    ward_name: str

    temperature_c: float
    relative_risk: float
    vulnerability_index: float
    risk_index: float
    risk_category: str

    heat_index_c: float
    simplified_wbgt_c: float


class CityRiskResponse(BaseModel):
    total_wards: int
    results: List[WardRiskResponse]
