"""Read GeoJSON bytes into a GeoDataFrame and flag anything unusual."""
from __future__ import annotations

import json

import geopandas as gpd
from shapely import force_2d

# GeoJSON is always WGS84 lon/lat (RFC 7946), so the CRS is fixed.
CRS = "EPSG:4326"
Z_WARNING = "Elevation (Z) coordinates present — flattened to 2D for planar analysis."


class GeoParseError(ValueError):
    """Raised when input is not valid, usable GeoJSON."""


def load(data: bytes) -> tuple[gpd.GeoDataFrame, list[str]]:
    """Parse GeoJSON into a (GeoDataFrame, warnings) pair.

    Raises GeoParseError for anything that isn't a non-empty FeatureCollection.
    3D coordinates are flattened to 2D and reported as a warning instead of
    failing the whole upload.
    """
    try:
        obj = json.loads(data)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise GeoParseError(f"File is not valid JSON: {exc}") from exc

    if not isinstance(obj, dict) or obj.get("type") != "FeatureCollection":
        raise GeoParseError("Expected a GeoJSON FeatureCollection.")
    features = obj.get("features") or []
    if not features:
        raise GeoParseError("FeatureCollection contains no features.")

    try:
        gdf = gpd.GeoDataFrame.from_features(features, crs=CRS)
    except (KeyError, TypeError, ValueError) as exc:
        raise GeoParseError(f"Could not read features: {exc}") from exc

    warnings: list[str] = []
    if gdf.geometry.has_z.any():
        warnings.append(Z_WARNING)
        gdf.geometry = gdf.geometry.apply(force_2d)

    return gdf, warnings
