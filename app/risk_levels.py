"""Map the existing MRI categories to dashboard alert levels and colors."""

from app.heat_risk import classify_risk


RISK_LEVEL_ORDER = {"GREEN": 0, "YELLOW": 1, "ORANGE": 2, "RED": 3}
CATEGORY_TO_DASHBOARD = {
    "Low": {"alert_level": "GREEN", "label": "Low"},
    "Moderate": {"alert_level": "YELLOW", "label": "Moderate"},
    "High": {"alert_level": "ORANGE", "label": "High"},
    "Severe": {"alert_level": "RED", "label": "Very High"},
    "Extreme": {"alert_level": "RED", "label": "Extreme"},
}


def dashboard_risk(mri: float) -> dict[str, str | int]:
    category = classify_risk(mri)
    if mri < 1.25:
        score = round(max(0.0, (mri - 1.0) / 0.25 * 20))
    elif mri < 1.75:
        score = round(21 + (mri - 1.25) / 0.5 * 19)
    elif mri < 2.5:
        score = round(41 + (mri - 1.75) / 0.75 * 19)
    elif mri < 4.0:
        score = round(61 + (mri - 2.5) / 1.5 * 19)
    else:
        score = round(min(100.0, 81 + (mri - 4.0) * 9.5))
    return CATEGORY_TO_DASHBOARD[category] | {"score": int(score)}
