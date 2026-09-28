"""
Basic tests for the heat-health risk calculations.

Run:

    python tests/test_worked_example.py
"""

import sys
from pathlib import Path

# Allow this script to import the app package when run directly.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.heat_risk import (
    classify_risk,
    heat_health_risk,
    relative_risk,
    vulnerability_index,
)


def check_close(
    actual: float,
    expected: float,
    tolerance: float = 0.01,
):
    assert abs(actual - expected) <= tolerance, (
        f"Expected {expected}, got {actual}"
    )


def test_relative_risk_at_reference():
    rr = relative_risk(26.0)

    check_close(
        rr,
        1.0,
    )

    print("[PASS] RR at 26 C")


def test_relative_risk_at_40():
    rr = relative_risk(40.0)

    check_close(
        rr,
        1.34,
        tolerance=0.001,
    )

    print("[PASS] RR at 40 C")


def test_relative_risk_at_45():
    rr = relative_risk(45.0)

    check_close(
        rr,
        4.50,
        tolerance=0.001,
    )

    print("[PASS] RR at 45 C")


def test_vulnerability_index():
    vi = vulnerability_index(
        elderly_pct=18,
        outdoor_worker_pct=42,
        informal_housing_pct=40,
        comorbidity_proxy=28,
    )

    expected = (
        1.0
        + (
            0.30 * 18
            + 0.30 * 42
            + 0.20 * 40
            + 0.20 * 28
        ) / 100
    )

    check_close(
        vi,
        expected,
    )

    print("[PASS] Vulnerability index")


def test_complete_risk():
    result = heat_health_risk(
        temp_c=40.0,
        elderly_pct=18,
        outdoor_worker_pct=42,
        informal_housing_pct=40,
        comorbidity_proxy=28,
    )

    expected_rr = 1.34

    expected_vi = (
        1.0
        + (
            0.30 * 18
            + 0.30 * 42
            + 0.20 * 40
            + 0.20 * 28
        ) / 100
    )

    expected_risk = expected_rr * expected_vi

    check_close(
        result["relative_risk"],
        expected_rr,
    )

    check_close(
        result["vulnerability_index"],
        expected_vi,
    )

    check_close(
        result["risk_index"],
        expected_risk,
    )

    print("[PASS] Complete risk calculation")


def test_categories():
    assert classify_risk(1.0) == "Low"
    assert classify_risk(1.5) == "Moderate"
    assert classify_risk(2.0) == "High"
    assert classify_risk(3.0) == "Severe"
    assert classify_risk(5.0) == "Extreme"

    print("[PASS] Risk categories")


if __name__ == "__main__":
    test_relative_risk_at_reference()
    test_relative_risk_at_40()
    test_relative_risk_at_45()
    test_vulnerability_index()
    test_complete_risk()
    test_categories()

    print()
    print("All tests passed.")
