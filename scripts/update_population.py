"""Apply current ward census inputs and recalculate population projections."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import initialize_database  # noqa: E402
from app.population import refresh_population_projection  # noqa: E402


def main() -> None:
    initialize_database()
    result = refresh_population_projection()
    print(
        f"Updated {result['ward_count']} wards for {result['target_year']}; "
        f"Greater Mumbai CAGR: {result['annual_growth_rate'] * 100:.4f}% per year."
    )


if __name__ == "__main__":
    main()
