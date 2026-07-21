"""QAReport — one object that the API returns, the UI renders, and the golden
test pins down.

The dataclass shape is the contract. Geometry types are imported from
geometry.py so each concept has a single definition.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import geopandas as gpd

from farmqa import geometry, io, metrics
from farmqa.geometry import Duplicates, GeometryIssue

__all__ = ["QAReport", "GeometryIssue", "Duplicates", "build"]


@dataclass
class QAReport:
    count: int = 0
    geometry_types: dict[str, int] = field(default_factory=dict)
    crs: str = ""
    had_z: bool = False
    total_area_ha: float = 0.0
    area_method: str = "geodesic (pyproj.Geod WGS84)"
    invalid: list[GeometryIssue] = field(default_factory=list)
    duplicates: Duplicates = field(default_factory=Duplicates)
    by_property: dict[str, dict[str, int]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def build(gdf: gpd.GeoDataFrame, warnings: list[str] = ()) -> QAReport:
    """Build a QAReport from a normalized GeoDataFrame.

    Everything comes out as plain Python (ints, floats, strings) so it
    serializes cleanly for the API and the golden snapshot. Rows are keyed by
    the GeoDataFrame index.
    """
    issues = geometry.validate(gdf)
    dups = geometry.duplicates(gdf)
    geom_col = gdf.geometry.name

    return QAReport(
        count=len(gdf),
        geometry_types={str(k): int(v) for k, v in gdf.geom_type.value_counts().items()},
        crs="EPSG:4326",
        had_z=io.Z_WARNING in warnings,
        total_area_ha=round(sum(metrics.area_ha(g) for g in gdf.geometry), 4),
        invalid=[GeometryIssue(int(i.index), i.reason, i.fixable) for i in issues],
        duplicates=Duplicates(
            _ints(dups.exact), _ints(dups.normalized), _ints(dups.near), _ints(dups.overlaps)
        ),
        by_property=_summarize(gdf, geom_col),
        warnings=list(warnings),
    )


def _ints(groups: list[list[Any]]) -> list[list[int]]:
    return [[int(x) for x in g] for g in groups]


def _summarize(gdf: gpd.GeoDataFrame, geom_col: str) -> dict[str, dict[str, int]]:
    """Value counts for attribute columns that actually repeat (skip unique keys)."""
    out: dict[str, dict[str, int]] = {}
    for col in gdf.columns:
        if col == geom_col:
            continue
        counts = gdf[col].value_counts()
        if len(counts) < len(gdf):  # has duplicates -> worth summarizing
            out[col] = {str(k): int(v) for k, v in counts.items()}
    return out
