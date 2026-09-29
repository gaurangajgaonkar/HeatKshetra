# Mumbai ward boundary source

`MUMBAI.geojson` is copied from the `METROPOLITAN CITIES/MUMBAI.geojson` file in [datta07/INDIAN-SHAPEFILES](https://github.com/datta07/INDIAN-SHAPEFILES).

The source repository describes its data vintage as primarily 2019. This project filters the source collection down to 24 valid canonical MCGM ward polygons and skips locality features and the empty `K/W` feature. Verify the boundaries against current MCGM data before using them as authoritative.

The source repository is MIT-licensed. The bundled GeoJSON remains attributed to its source repository.

## Census population inputs

- `greater_mumbai_census_totals.csv` has one citywide population total per Census year. The app calculates CAGR from the latest two rows at or before the target year.
- `ward_population_census.csv` has one row per ward and census year. The app projects each ward's latest available population to the current year using that CAGR. This uniform rate is an approximation and is not ward-specific.
- Current ward populations are low/medium-confidence entries from the source HeatKshetra project. They are not certified as official Census ward counts.
- When official 2027 ward data is published, add rows for all 24 wards using canonical ward codes (`FN`, `FS`, `GN`, etc.), `census_year=2027`, the official population and `confidence=official`. Add the Greater Mumbai 2027 total to the city totals CSV. The running API checks these files on its weather refresh schedule; restart the API or run `python scripts/update_population.py` to apply changes immediately.
- `mortality_baseline.csv` is a placeholder proxy. The dashboard's excess-death estimate is illustrative and should not be used as a mortality forecast.
