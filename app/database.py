"""SQLite connection and schema initialization for HeatKshetra."""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env", override=False)
SCHEMA_FILE = ROOT / "db" / "schema.sql"


def database_path() -> Path:
    url = os.getenv("DATABASE_URL", "sqlite:///./heatkshetra.db")
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        raise RuntimeError("This demo currently supports SQLite DATABASE_URL values only.")
    raw_path = url[len(prefix):]
    path = Path(raw_path)
    if not path.is_absolute():
        path = ROOT / path
    return path.resolve()


@contextmanager
def connect_db() -> Iterator[sqlite3.Connection]:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=20)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 20000")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database(geojson_path: Path | None = None) -> None:
    from app.ward_import import GEOJSON_FILE, load_ward_records

    source_path = geojson_path or GEOJSON_FILE
    with connect_db() as connection:
        connection.executescript(SCHEMA_FILE.read_text(encoding="utf-8"))
        thermal_columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(thermal_indices)").fetchall()
        }
        if "source" not in thermal_columns:
            connection.execute("ALTER TABLE thermal_indices ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown'")
        if "is_simulated" not in thermal_columns:
            connection.execute("ALTER TABLE thermal_indices ADD COLUMN is_simulated INTEGER NOT NULL DEFAULT 1")
        ward_columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(wards)").fetchall()
        }
        ward_migrations = {
            "population_2011": "INTEGER",
            "population_source_year": "INTEGER",
            "population_estimate_year": "INTEGER",
            "population_is_projected": "INTEGER NOT NULL DEFAULT 1",
            "population_confidence": "TEXT",
            "population_source": "TEXT",
            "baseline_daily_deaths": "REAL",
            "population_updated_at": "TEXT",
        }
        for column, definition in ward_migrations.items():
            if column not in ward_columns:
                connection.execute(f"ALTER TABLE wards ADD COLUMN {column} {definition}")
        count = connection.execute("SELECT COUNT(*) FROM wards").fetchone()[0]
        if count == 0:
            records, _ = load_ward_records(source_path)
            connection.executemany(
                """
                INSERT INTO wards (
                    ward_code, ward_name, city, geometry_geojson,
                    source_properties_json, elderly_pct, outdoor_worker_pct,
                    informal_housing_pct, comorbidity_proxy, is_placeholder, source
                ) VALUES (
                    :ward_code, :ward_name, :city, :geometry_geojson,
                    :source_properties_json, :elderly_pct, :outdoor_worker_pct,
                    :informal_housing_pct, :comorbidity_proxy, 1,
                    'datta07/INDIAN-SHAPEFILES + example demographics'
                )
                """,
                records,
            )


def table_count(table_name: str) -> int:
    allowed = {"wards", "weather_obs", "thermal_indices", "risk_forecast", "subscribers", "alerts_log", "push_subscriptions", "push_delivery_log"}
    if table_name not in allowed:
        raise ValueError("Unsupported table name.")
    with connect_db() as connection:
        return int(connection.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0])
