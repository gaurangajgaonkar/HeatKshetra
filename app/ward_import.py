"""Load the Mumbai ward GeoJSON and demo-only vulnerability profile."""

from __future__ import annotations

import csv
import json
from statistics import median
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
GEOJSON_FILE = ROOT / "app" / "data" / "MUMBAI.geojson"
DEMOGRAPHICS_FILE = ROOT / "app" / "data" / "wards_demographics.csv"

# Explicit crosswalk order for the generic W01..W24 example CSV. Every value
# imported from that file remains is_placeholder=1; it is not official data.
WARD_CODE_ORDER = (
    "A", "B", "C", "D", "E", "FN", "FS", "GN", "GS", "HE", "HW", "KE",
    "KW", "PN", "PS", "RC", "RN", "RS", "L", "ME", "MW", "N", "S", "T",
)
WARD_NAME_TO_CODE = {
    f"{code} WARD": code for code in ("A", "B", "C", "D", "E", "L", "N", "S", "T")
}
WARD_NAME_TO_CODE.update({
    "F/N WARD": "FN", "F/S WARD": "FS", "G/N WARD": "GN", "G/S WARD": "GS",
    "H/E WARD": "HE", "H/W WARD": "HW", "K/E WARD": "KE", "K/W WARD": "KW",
    "P/N WARD": "PN", "P/S WARD": "PS", "R/C WARD": "RC", "R/N WARD": "RN",
    "R/S WARD": "RS", "M/E WARD": "ME", "M/W WARD": "MW",
})


def load_ward_records(geojson_path: Path = GEOJSON_FILE) -> tuple[list[dict[str, Any]], int]:
    geojson = json.loads(geojson_path.read_text(encoding="utf-8"))
    features = geojson.get("features")
    if not isinstance(features, list):
        raise ValueError("Input must be a GeoJSON FeatureCollection with a features list.")

    wards: dict[str, dict[str, Any]] = {}
    skipped = 0
    for index, feature in enumerate(features):
        properties = feature.get("properties") or {}
        name = str(properties.get("Name", "")).strip()
        code = WARD_NAME_TO_CODE.get(name.upper())
        geometry = feature.get("geometry")
        if code is None or not geometry or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            skipped += 1
            continue
        if not geometry.get("coordinates"):
            skipped += 1
            continue
        if code in wards:
            raise ValueError(f"Duplicate source feature for ward {code!r} at feature {index}.")
        wards[code] = {
            "ward_code": code,
            "ward_name": name,
            "city": str(properties.get("City") or "Mumbai").title(),
            "geometry_geojson": json.dumps(geometry, separators=(",", ":")),
            "source_properties_json": json.dumps(properties, separators=(",", ":")),
        }

    expected = set(WARD_CODE_ORDER)
    missing = sorted(expected - wards.keys())
    if missing or wards.keys() - expected:
        raise ValueError(f"Ward coverage mismatch. Missing: {missing}.")

    profiles = _load_demo_profiles()
    records = []
    for code in WARD_CODE_ORDER:
        ward = wards[code]
        ward.update(profiles[code])
        records.append(ward)
    return records, skipped


def _load_demo_profiles() -> dict[str, dict[str, float]]:
    with DEMOGRAPHICS_FILE.open("r", encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))
    if not rows or len(rows) > len(WARD_CODE_ORDER):
        raise ValueError(
            f"Expected 1 to {len(WARD_CODE_ORDER)} demo demographic rows; found {len(rows)}."
        )
    rows.sort(key=lambda row: int(row["ward_id"].removeprefix("W")))
    fields = ("elderly_pct", "outdoor_worker_pct", "informal_housing_pct", "comorbidity_proxy")
    profiles = {
        WARD_CODE_ORDER[index]: {
            "elderly_pct": float(row["elderly_pct"]),
            "outdoor_worker_pct": float(row["outdoor_worker_pct"]),
            "informal_housing_pct": float(row["informal_housing_pct"]),
            "comorbidity_proxy": float(row["comorbidity_proxy"]),
        }
        for index, row in enumerate(rows)
    }
    # The checked-in example CSV currently has eight generic rows. Use its
    # column medians as visibly synthetic placeholders for the remaining wards.
    fallback = {field: float(median(float(row[field]) for row in rows)) for field in fields}
    return {code: profiles.get(code, fallback.copy()) for code in WARD_CODE_ORDER}
