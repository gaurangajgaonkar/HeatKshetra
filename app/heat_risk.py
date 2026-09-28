"""
Core heat-health risk calculations.

IMPORTANT:
This module implements a deterministic, epidemiologically-inspired
risk index. It is NOT a trained machine-learning model.

The current calibration uses three temperature/RR anchor points
from the project methodology:

    MMT / reference temperature = 26 C -> RR = 1.00
    40 C -> RR = 1.34
    45 C -> RR = 4.50

The exposure-response curve is piecewise exponential.

The current vulnerability score is a transparent demonstration
index and should be recalibrated when better local evidence is available.
"""

from dataclasses import dataclass
from math import exp, log
from typing import Dict


@dataclass(frozen=True)
class CurveCalibration:
    """Temperature/RR anchor points."""

    reference_temp_c: float = 26.0
    reference_rr: float = 1.0

    anchor_temp_c: float = 40.0
    anchor_rr: float = 1.34

    extreme_temp_c: float = 45.0
    extreme_rr: float = 4.50


CALIBRATION = CurveCalibration()


def _beta(
    rr_start: float,
    rr_end: float,
    temp_start: float,
    temp_end: float,
) -> float:
    """
    Calculate the exponential coefficient beta.

    RR(T) = RR_start * exp(beta * (T - temp_start))
    """

    return log(rr_end / rr_start) / (temp_end - temp_start)


BETA_1 = _beta(
    CALIBRATION.reference_rr,
    CALIBRATION.anchor_rr,
    CALIBRATION.reference_temp_c,
    CALIBRATION.anchor_temp_c,
)

BETA_2 = _beta(
    CALIBRATION.anchor_rr,
    CALIBRATION.extreme_rr,
    CALIBRATION.anchor_temp_c,
    CALIBRATION.extreme_temp_c,
)


def relative_risk(temp_c: float) -> float:
    """
    Estimate relative risk for a given temperature.

    NOTE:
    This curve is based on the project's current demonstration
    calibration. It should not be interpreted as a clinically
    validated individual mortality probability.

    Values beyond the calibration range are extrapolations.
    """

    if temp_c <= CALIBRATION.reference_temp_c:
        return CALIBRATION.reference_rr

    if temp_c <= CALIBRATION.anchor_temp_c:
        return (
            CALIBRATION.reference_rr
            * exp(
                BETA_1
                * (temp_c - CALIBRATION.reference_temp_c)
            )
        )

    return (
        CALIBRATION.anchor_rr
        * exp(
            BETA_2
            * (temp_c - CALIBRATION.anchor_temp_c)
        )
    )


def vulnerability_index(
    elderly_pct: float,
    outdoor_worker_pct: float,
    informal_housing_pct: float,
    comorbidity_proxy: float,
) -> float:
    """
    Calculate a transparent vulnerability multiplier.

    Inputs are percentages from 0-100, except that the function
    accepts comorbidity_proxy on the same 0-100 scale.

    The current weights are demonstration assumptions:

        elderly population       30%
        outdoor workers          30%
        informal housing         20%
        comorbidity proxy        20%

    The result is centered around 1.0.

    Example:
        1.0 = baseline vulnerability
        >1.0 = elevated vulnerability

    These weights should eventually be supported by local evidence
    or calibrated against real health outcomes.
    """

    values = {
        "elderly": elderly_pct,
        "outdoor_worker": outdoor_worker_pct,
        "informal_housing": informal_housing_pct,
        "comorbidity": comorbidity_proxy,
    }

    for name, value in values.items():
        if not 0 <= value <= 100:
            raise ValueError(
                f"{name} must be between 0 and 100. Got {value}."
            )

    weighted_vulnerability = (
        0.30 * elderly_pct
        + 0.30 * outdoor_worker_pct
        + 0.20 * informal_housing_pct
        + 0.20 * comorbidity_proxy
    )

    # Convert percentage points into a multiplier.
    #
    # 50 weighted vulnerability points -> VI = 1.50
    #
    # This keeps the demonstration index simple and transparent.
    return 1.0 + (weighted_vulnerability / 100.0)


def heat_health_risk(
    temp_c: float,
    elderly_pct: float,
    outdoor_worker_pct: float,
    informal_housing_pct: float,
    comorbidity_proxy: float,
) -> Dict[str, float]:
    """
    Calculate the complete heat-health risk index for a ward.
    """

    rr = relative_risk(temp_c)

    vi = vulnerability_index(
        elderly_pct=elderly_pct,
        outdoor_worker_pct=outdoor_worker_pct,
        informal_housing_pct=informal_housing_pct,
        comorbidity_proxy=comorbidity_proxy,
    )

    risk_index = rr * vi

    return {
        "temperature_c": round(temp_c, 2),
        "relative_risk": round(rr, 4),
        "vulnerability_index": round(vi, 4),
        "risk_index": round(risk_index, 4),
    }


def classify_risk(risk_index: float) -> str:
    """
    Convert the numerical risk index into a human-readable category.

    These thresholds are project demonstration thresholds and
    should not be interpreted as medical thresholds.
    """

    if risk_index < 1.25:
        return "Low"

    if risk_index < 1.75:
        return "Moderate"

    if risk_index < 2.50:
        return "High"

    if risk_index < 4.00:
        return "Severe"

    return "Extreme"
