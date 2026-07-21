"""Geometry validity, repair, and duplicate/overlap detection.

Works on a GeoDataFrame and refers to rows by their index; turning an index
into a business key (fid) is the report layer's job, so this stays generic.
The dataclasses below are the shared contract that report.py reuses.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import geopandas as gpd
from shapely import make_valid
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree
from shapely.validation import explain_validity

NEAR_IOU = 0.98  # intersection-over-union threshold for near-duplicates
OVERLAP_MIN = 0.05  # boundary conflict: >= 5% of the smaller plot is shared


@dataclass
class GeometryIssue:
    index: Any
    reason: str
    fixable: bool


@dataclass
class GeometryFix:
    index: Any
    reason: str
    repaired: bool


@dataclass
class Duplicates:
    exact: list[list[Any]] = field(default_factory=list)       # identical coords
    normalized: list[list[Any]] = field(default_factory=list)  # equal ignoring vertex order
    near: list[list[Any]] = field(default_factory=list)        # IoU >= NEAR_IOU
    overlaps: list[list[Any]] = field(default_factory=list)    # distinct fields sharing ground


def validate(gdf: gpd.GeoDataFrame) -> list[GeometryIssue]:
    """Report empty/missing and invalid (e.g. self-intersecting) geometries."""
    issues: list[GeometryIssue] = []
    for index, geom in gdf.geometry.items():
        if geom is None or geom.is_empty:
            issues.append(GeometryIssue(index, "Empty or missing geometry", fixable=False))
        elif not geom.is_valid:
            issues.append(GeometryIssue(index, explain_validity(geom), fixable=True))
    return issues


def fix(gdf: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, list[GeometryFix]]:
    """Repair invalid geometries with make_valid; return (new_gdf, changes)."""
    repaired = gdf.copy()
    column = gdf.geometry.name
    changes: list[GeometryFix] = []
    for index, geom in gdf.geometry.items():
        if geom is not None and not geom.is_empty and not geom.is_valid:
            new_geom = make_valid(geom)
            repaired.at[index, column] = new_geom
            changes.append(GeometryFix(index, explain_validity(geom), bool(new_geom.is_valid)))
    return repaired, changes


def duplicates(gdf: gpd.GeoDataFrame, near_iou: float = NEAR_IOU) -> Duplicates:
    """Find repeated and conflicting geometries.

    Three duplicate tiers (exact, normalized, near) plus boundary overlaps
    between distinct plots. The hash tiers are cheap; the spatial tiers query
    an STRtree so only bounding-box neighbours are compared, instead of the
    all-pairs overlay that would stall on real-world file sizes.
    """
    ids = list(gdf.index)
    present = [
        (pos, g) for pos, g in enumerate(gdf.geometry)
        if g is not None and not g.is_empty
    ]
    wkb = {pos: g.wkb for pos, g in present}
    norm = {pos: g.normalize().wkb for pos, g in present}

    def groups(mapping: dict[int, bytes]) -> list[list[int]]:
        buckets: dict[bytes, list[int]] = {}
        for pos, key in mapping.items():
            buckets.setdefault(key, []).append(pos)
        return [positions for positions in buckets.values() if len(positions) > 1]

    exact = groups(wkb)
    # A normalized group only matters if its members differ byte-for-byte;
    # otherwise it is already reported as exact.
    normalized = [g for g in groups(norm) if len({wkb[p] for p in g}) > 1]

    # Overlay of invalid geometry is unreliable — spatial tiers use valid only.
    candidates = [(pos, g) for pos, g in present if g.is_valid]
    near: list[list[int]] = []
    overlaps: list[list[int]] = []
    if len(candidates) > 1:
        tree = STRtree([g for _, g in candidates])
        for i, (pos_a, geom_a) in enumerate(candidates):
            for j in tree.query(geom_a):
                if int(j) <= i:
                    continue  # each pair once
                pos_b, geom_b = candidates[int(j)]
                if norm[pos_a] == norm[pos_b]:
                    continue  # same shape — handled by exact/normalized
                inter = geom_a.intersection(geom_b).area
                union = geom_a.union(geom_b).area
                if union and inter / union >= near_iou:
                    near.append([pos_a, pos_b])  # same field, re-digitized
                else:
                    # Different fields claiming the same ground: a boundary
                    # conflict, measured against the smaller plot.
                    smaller = min(geom_a.area, geom_b.area)
                    if smaller and inter / smaller >= OVERLAP_MIN:
                        overlaps.append([pos_a, pos_b])

    to_ids = lambda gs: [[ids[p] for p in g] for g in gs]
    return Duplicates(to_ids(exact), to_ids(normalized), to_ids(near), to_ids(overlaps))


def _iou(a: BaseGeometry, b: BaseGeometry) -> float:
    """Intersection-over-union (planar; the ratio is unit-independent)."""
    union = a.union(b).area
    return a.intersection(b).area / union if union else 0.0
