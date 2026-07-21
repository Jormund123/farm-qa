"""Plot area in hectares, measured on the curve of the Earth."""
from __future__ import annotations

from pyproj import Geod
from shapely.geometry.base import BaseGeometry

_GEOD = Geod(ellps="WGS84")


def area_ha(geom: BaseGeometry) -> float:
    if geom is None or geom.is_empty:
        return 0.0
    # Geodesic area on the WGS84 ellipsoid. GeoDataFrame.area would return
    # square-degrees here, which mean nothing for lon/lat coordinates.
    area_m2, _perimeter = _GEOD.geometry_area_perimeter(geom)
    return abs(area_m2) / 10_000.0
