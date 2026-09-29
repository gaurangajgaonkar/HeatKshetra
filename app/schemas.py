"""Request and response schemas for the HeatKshetra API."""

from typing import Literal

from pydantic import BaseModel, Field


class Ward(BaseModel):
    ward_id: str
    ward_name: str
    elderly_pct: float = Field(ge=0, le=100)
    outdoor_worker_pct: float = Field(ge=0, le=100)
    informal_housing_pct: float = Field(ge=0, le=100)
    comorbidity_proxy: float = Field(ge=0, le=100)
    is_placeholder: bool = True
    source: str
    population: int | None = None
    population_2011: int | None = None
    population_source_year: int | None = None
    population_estimate_year: int | None = None
    population_is_projected: bool = True
    population_confidence: str | None = None
    population_source: str | None = None


class ExposureRequest(BaseModel):
    temperature_c: float
    relative_humidity_pct: float = Field(ge=0, le=100)
    wind_speed_ms: float = Field(default=1.0, ge=0)


class WardRiskResponse(BaseModel):
    ward_id: str
    ward_name: str

    temperature_c: float
    relative_risk: float
    vulnerability_index: float
    risk_index: float
    risk_category: str
    alert_level: str

    heat_index_c: float
    simplified_wbgt_c: float
    is_placeholder: bool = True
    data_source: str = "SIMULATED_DEMO"


class CityRiskResponse(BaseModel):
    total_wards: int
    results: list[WardRiskResponse]


class SubscribeRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=24, pattern=r"^\+?[0-9][0-9\s()\-]{7,22}$")
    channel: Literal["SMS", "WHATSAPP"]
    ward_id: str = Field(min_length=1, max_length=8)
    language: Literal["en", "hi", "mr"] = "en"
    consent: bool


class AlertTriggerRequest(BaseModel):
    risk_level: Literal["GREEN", "YELLOW", "ORANGE", "RED"] = "ORANGE"
    ward_ids: list[str] | None = None


class SmsDemoRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=24, pattern=r"^\+?[0-9][0-9\s()\-]{7,22}$")


class PushSubscriptionRequest(BaseModel):
    token: str = Field(min_length=40, max_length=4096)
    ward_id: str = Field(min_length=1, max_length=8)
    consent: bool


class PushDemoRequest(BaseModel):
    subscription_id: int = Field(ge=1)
