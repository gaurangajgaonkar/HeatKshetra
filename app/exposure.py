"""
Environmental heat exposure calculations.

Primary metric:
    Heat Index (HI)

Optional:
    Simplified WBGT estimate

The Heat Index calculation uses the NOAA/NWS regression and
requires air temperature + relative humidity.

The simplified WBGT function is only an estimate. True outdoor
WBGT requires additional radiant/solar information.
"""

from typing import Optional


def celsius_to_fahrenheit(temp_c: float) -> float:
    return (temp_c * 9.0 / 5.0) + 32.0


def fahrenheit_to_celsius(temp_f: float) -> float:
    return (temp_f - 32.0) * 5.0 / 9.0


def compute_heat_index_c(
    temp_c: float,
    rh_pct: float,
) -> float:
    """
    Calculate Heat Index in Celsius.

    Parameters:
        temp_c: air temperature in Celsius
        rh_pct: relative humidity in %

    Returns:
        Heat Index in Celsius.

    For lower temperatures, the simple average of temperature
    and humidity-adjusted approximation is used rather than
    applying the full regression outside its intended range.
    """

    if not 0 <= rh_pct <= 100:
        raise ValueError("Relative humidity must be between 0 and 100.")

    temp_f = celsius_to_fahrenheit(temp_c)

    # Rothfusz regression is primarily intended for hot conditions.
    # Below 80 F, use the simple NOAA-style approximation.
    if temp_f < 80:
        hi_f = (
            0.5
            * (
                temp_f
                + 61.0
                + ((temp_f - 68.0) * 1.2)
                + (rh_pct * 0.094)
            )
        )

        return round(fahrenheit_to_celsius(hi_f), 2)

    # NOAA/NWS Rothfusz regression coefficients.
    c1 = -42.379
    c2 = 2.04901523
    c3 = 10.14333127
    c4 = -0.22475541
    c5 = -0.00683783
    c6 = -0.05481717
    c7 = 0.00122874
    c8 = 0.00085282
    c9 = -0.00000199

    hi_f = (
        c1
        + c2 * temp_f
        + c3 * rh_pct
        + c4 * temp_f * rh_pct
        + c5 * temp_f**2
        + c6 * rh_pct**2
        + c7 * temp_f**2 * rh_pct
        + c8 * temp_f * rh_pct**2
        + c9 * temp_f**2 * rh_pct**2
    )

    # Adjustment for low humidity.
    if rh_pct < 13 and 80 <= temp_f <= 112:
        adjustment = (
            ((13 - rh_pct) / 4)
            * ((17 - abs(temp_f - 95)) / 17) ** 0.5
        )

        hi_f -= adjustment

    # Adjustment for high humidity.
    elif rh_pct > 85 and 80 <= temp_f <= 87:
        adjustment = (
            ((rh_pct - 85) / 10)
            * ((87 - temp_f) / 5)
        )

        hi_f += adjustment

    return round(fahrenheit_to_celsius(hi_f), 2)


def compute_simplified_wbgt_c(
    temp_c: float,
    rh_pct: float,
    wind_speed_ms: Optional[float] = None,
) -> float:
    """
    Estimate outdoor WBGT from limited weather inputs.

    WARNING:
        This is NOT true globe-thermometer WBGT.

    True outdoor WBGT incorporates radiant/solar heat. Since a
    normal weather API may not provide globe temperature or
    sufficient radiation measurements, this function is only
    a demonstration approximation.

    Do not describe this value as sensor-grade WBGT.
    """

    if not 0 <= rh_pct <= 100:
        raise ValueError("Relative humidity must be between 0 and 100.")

    if wind_speed_ms is None:
        wind_speed_ms = 1.0

    if wind_speed_ms < 0:
        raise ValueError("Wind speed cannot be negative.")

    # Approximate wet-bulb temperature using Stull's formula.
    import math

    rh = rh_pct

    wet_bulb = (
        temp_c * math.atan(0.151977 * math.sqrt(rh + 8.313659))
        + math.atan(temp_c + rh)
        - math.atan(rh - 1.676331)
        + 0.00391838 * rh ** 1.5
        * math.atan(0.023101 * rh)
        - 4.686035
    )

    # Simplified outdoor WBGT estimate.
    # This deliberately remains clearly labelled as approximate.
    wbgt = (
        0.7 * wet_bulb
        + 0.2 * temp_c
        + 0.1 * temp_c
    )

    return round(wbgt, 2)
