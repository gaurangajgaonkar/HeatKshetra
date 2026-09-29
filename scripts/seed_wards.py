"""Initialize the local database with Mumbai wards and demo forecasts."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import initialize_database, table_count  # noqa: E402
from app.demo_data import refresh_demo_forecasts  # noqa: E402
from app.ward_import import GEOJSON_FILE  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--geojson", type=Path, default=GEOJSON_FILE)
    args = parser.parse_args()
    if not args.geojson.is_file():
        parser.error(f"GeoJSON file not found: {args.geojson}")

    initialize_database(args.geojson)
    refresh_demo_forecasts()
    print(f"Database ready with {table_count('wards')} Mumbai wards.")
    print(f"Saved {table_count('risk_forecast')} clearly marked demo risk forecasts.")


if __name__ == "__main__":
    main()
