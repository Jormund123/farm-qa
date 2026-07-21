"""In-memory store of uploaded datasets, keyed by file id.

A plain dict on purpose. State is lost on restart and it isn't multi-user;
that's a known limitation, and PostGIS would be the production path.
"""
from __future__ import annotations

import uuid
from typing import Any

import geopandas as gpd

_STORE: dict[str, dict[str, Any]] = {}


def put(gdf: gpd.GeoDataFrame, warnings: list[str]) -> str:
    file_id = uuid.uuid4().hex[:12]
    _STORE[file_id] = {"gdf": gdf, "warnings": warnings, "cache": {}}
    return file_id


def get(file_id: str) -> dict[str, Any]:
    return _STORE[file_id]  # raises KeyError -> mapped to 404


def set_gdf(file_id: str, gdf: gpd.GeoDataFrame, warnings: list[str] | None = None) -> None:
    _STORE[file_id]["gdf"] = gdf
    _STORE[file_id]["cache"] = {}  # dataset changed — cached analysis is stale
    if warnings is not None:
        _STORE[file_id]["warnings"] = warnings
