"""Unit tests for the farmqa core: loading, area, and geometry checks."""
from __future__ import annotations

import geopandas as gpd
import pytest
from hypothesis import assume, given
from hypothesis import strategies as st
from shapely.geometry import MultiPoint, Polygon

from farmqa import geometry, io, metrics
from farmqa.io import GeoParseError


# helpers
def _gdf(*geoms) -> gpd.GeoDataFrame:
    """Build a WGS84 GeoDataFrame with fids 1..N from bare shapely geometries."""
    return gpd.GeoDataFrame(
        {"fid": list(range(1, len(geoms) + 1))},
        geometry=list(geoms),
        crs="EPSG:4326",
    )


def _square(x: float = 0.0, y: float = 0.0, s: float = 1.0) -> Polygon:
    return Polygon([(x, y), (x, y + s), (x + s, y + s), (x + s, y), (x, y)])


_BOWTIE = Polygon([(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)])  # self-intersecting


@pytest.fixture
def sample_gdf(sample_bytes: bytes) -> gpd.GeoDataFrame:
    gdf, _ = io.load(sample_bytes)
    return gdf


# io: loading and normalizing
@pytest.mark.unit
class TestLoad:
    def test_reads_all_features(self, sample_gdf: gpd.GeoDataFrame) -> None:
        assert len(sample_gdf) == 5

    def test_preserves_properties(self, sample_gdf: gpd.GeoDataFrame) -> None:
        assert {"fid", "producttype", "DRI"} <= set(sample_gdf.columns)
        assert set(sample_gdf["producttype"]) == {"Coffee"}

    def test_sets_wgs84_crs(self, sample_gdf: gpd.GeoDataFrame) -> None:
        assert sample_gdf.crs.to_epsg() == 4326

    def test_flattens_3d_to_2d(self, sample_bytes: bytes) -> None:
        gdf, warnings = io.load(sample_bytes)
        assert not gdf.geometry.has_z.any()
        assert any("2D" in w for w in warnings)

    def test_no_warning_for_plain_2d(self) -> None:
        data = (
            b'{"type":"FeatureCollection","features":[{"type":"Feature",'
            b'"properties":{},"geometry":{"type":"Polygon","coordinates":'
            b"[[[0,0],[0,1],[1,1],[0,0]]]}}]}"
        )
        _, warnings = io.load(data)
        assert warnings == []


@pytest.mark.unit
class TestLoadErrors:
    def test_rejects_malformed_json(self) -> None:
        with pytest.raises(GeoParseError, match="valid JSON"):
            io.load(b"{not json")

    def test_rejects_non_feature_collection(self) -> None:
        with pytest.raises(GeoParseError, match="FeatureCollection"):
            io.load(b'{"type":"Feature","geometry":null,"properties":{}}')

    def test_rejects_empty_collection(self) -> None:
        with pytest.raises(GeoParseError, match="no features"):
            io.load(b'{"type":"FeatureCollection","features":[]}')


# area: hectares on the globe, never degrees
@pytest.mark.unit
class TestAreaHa:
    def test_all_polygons_positive(self, sample_gdf: gpd.GeoDataFrame) -> None:
        assert all(metrics.area_ha(g) > 0 for g in sample_gdf.geometry)

    def test_matches_utm_reprojection(self, sample_gdf: gpd.GeoDataFrame) -> None:
        # Independent cross-check: geodesic (pyproj.Geod) must agree with an
        # equal-area projection (UTM 18N) for these Colombian plots.
        geodesic = sum(metrics.area_ha(g) for g in sample_gdf.geometry)
        utm = sample_gdf.to_crs(32618).geometry.area.sum() / 10_000
        assert abs(geodesic - utm) / utm < 0.005

    def test_result_is_hectares_not_degrees(
        self, sample_gdf: gpd.GeoDataFrame
    ) -> None:
        # The trap: raw planar area is in deg^2 (~1e-6). Hectares are ~1e6x larger.
        for geom in sample_gdf.geometry:
            assert metrics.area_ha(geom) > geom.area * 1_000

    def test_empty_geometry_is_zero(self) -> None:
        assert metrics.area_ha(Polygon()) == 0.0


# geometry: validity, repair, duplicates
@pytest.mark.unit
class TestValidate:
    def test_flags_the_invalid_plot_in_real_file(
        self, sample_gdf: gpd.GeoDataFrame
    ) -> None:
        issues = geometry.validate(sample_gdf)
        assert len(issues) == 1
        (issue,) = issues
        assert int(sample_gdf.loc[issue.index, "fid"]) == 5  # the planted case
        assert issue.fixable is True

    def test_valid_geometry_has_no_issues(self) -> None:
        assert geometry.validate(_gdf(_square())) == []

    def test_self_intersection_reason(self) -> None:
        (issue,) = geometry.validate(_gdf(_BOWTIE))
        assert "Self-intersection" in issue.reason

    def test_empty_geometry_flagged_and_not_fixable(self) -> None:
        (issue,) = geometry.validate(_gdf(Polygon()))
        assert issue.fixable is False


@pytest.mark.unit
class TestFix:
    def test_repairs_invalid_geometry(self) -> None:
        fixed, changes = geometry.fix(_gdf(_BOWTIE))
        assert len(changes) == 1
        assert changes[0].repaired is True
        assert geometry.validate(fixed) == []  # no issues remain

    def test_leaves_valid_geometry_untouched(self) -> None:
        square = _square()
        fixed, changes = geometry.fix(_gdf(square))
        assert changes == []
        assert fixed.geometry.iloc[0].equals(square)


@pytest.mark.unit
class TestDuplicates:
    def test_exact_duplicate_in_real_file(
        self, sample_gdf: gpd.GeoDataFrame
    ) -> None:
        dups = geometry.duplicates(sample_gdf)

        def fids(group):
            return frozenset(int(sample_gdf.loc[i, "fid"]) for i in group)

        # Exact tier: fids 1 & 2 are byte-identical.
        assert [fids(g) for g in dups.exact] == [frozenset({1, 2})]
        # Normalized tier reveals a HIDDEN duplicate: fid 3 is the same polygon
        # as 1 & 2 with a different vertex order — a raw-hash check misses it.
        assert [fids(g) for g in dups.normalized] == [frozenset({1, 2, 3})]
        # Near tier: fid 4 is a near-identical variant (IoU ~0.998) of 1/2/3.
        assert {fids(g) for g in dups.near} == {
            frozenset({1, 4}),
            frozenset({2, 4}),
            frozenset({3, 4}),
        }

    def test_normalized_detects_reordered_ring(self) -> None:
        p1 = Polygon([(0, 0), (0, 1), (1, 1), (1, 0)])
        p2 = Polygon([(1, 1), (1, 0), (0, 0), (0, 1)])  # same ring, rotated start
        dups = geometry.duplicates(_gdf(p1, p2))
        assert dups.exact == []
        assert len(dups.normalized) == 1

    def test_near_duplicate_by_iou(self) -> None:
        dups = geometry.duplicates(_gdf(_square(), _square(0.002, 0.002)))
        assert len(dups.near) == 1

    def test_distinct_geometries_have_no_duplicates(self) -> None:
        dups = geometry.duplicates(_gdf(_square(0, 0), _square(5, 5), _square(10, 10)))
        assert dups.exact == dups.normalized == dups.near == []


# property-based invariants (Hypothesis)
_pts = st.lists(
    st.tuples(
        st.floats(-10, 10, allow_nan=False, allow_infinity=False),
        st.floats(-10, 10, allow_nan=False, allow_infinity=False),
    ),
    min_size=3,
    max_size=8,
)


def _valid_polygon(points) -> Polygon:
    poly = MultiPoint(points).convex_hull
    assume(poly.geom_type == "Polygon" and poly.area > 1e-6)
    return poly


@pytest.mark.property
class TestInvariants:
    @given(_pts)
    def test_area_invariant_under_vertex_rotation(self, points) -> None:
        poly = _valid_polygon(points)
        ring = list(poly.exterior.coords)[:-1]
        base = metrics.area_ha(poly)
        for k in range(len(ring)):
            rotated = Polygon(ring[k:] + ring[:k])
            assert metrics.area_ha(rotated) == pytest.approx(base, rel=1e-9)

    @given(st.lists(
        st.tuples(
            st.floats(-10, 10, allow_nan=False, allow_infinity=False),
            st.floats(-10, 10, allow_nan=False, allow_infinity=False),
        ),
        min_size=4, max_size=8,
    ))
    def test_fix_output_is_always_valid(self, points) -> None:
        poly = Polygon(points)  # may self-intersect
        assume(not poly.is_empty)
        fixed, _ = geometry.fix(_gdf(poly))
        assert geometry.validate(fixed) == []

    @given(_pts)
    def test_identical_copy_is_exact_duplicate(self, points) -> None:
        poly = _valid_polygon(points)
        copy = Polygon(poly.exterior.coords)
        dups = geometry.duplicates(_gdf(poly, copy))
        assert len(dups.exact) == 1


# scale and robustness: a real file will be bigger and messier than the sample
@pytest.mark.unit
class TestScale:
    def test_near_duplicates_use_spatial_index_not_all_pairs(self) -> None:
        """1,501 features must finish in seconds, not minutes.

        A 50x30 grid of disjoint squares plus ONE nudged near-twin of the
        first cell. Pairwise IoU is ~1.1M overlay ops; an R-tree (STRtree)
        only compares bbox-overlapping candidates.
        """
        import time
        from shapely.affinity import translate

        cells = [_square(i * 0.01, j * 0.01, s=0.008) for i in range(50) for j in range(30)]
        cells.append(translate(cells[0], xoff=1e-5))  # IoU ~0.9975 with cells[0]
        gdf = _gdf(*cells)

        start = time.perf_counter()
        d = geometry.duplicates(gdf)
        elapsed = time.perf_counter() - start

        assert d.exact == [] and d.normalized == []
        assert d.near == [[0, 1500]]
        assert elapsed < 2.0, f"duplicates() took {elapsed:.1f}s — not using a spatial index?"

    def test_duplicates_skips_missing_and_empty_geometries(self) -> None:
        gdf = gpd.GeoDataFrame(
            {"fid": [1, 2, 3, 4]},
            geometry=[_square(), None, Polygon(), _square()],
            crs="EPSG:4326",
        )
        d = geometry.duplicates(gdf)
        assert d.exact == [[0, 3]]  # the two real squares; None/empty don't crash
        assert d.normalized == [] and d.near == []

    def test_iou_handles_zero_area_geometries(self) -> None:
        from shapely.geometry import Point

        gdf = _gdf(Point(0, 0), Point(0, 0), Point(1, 1))
        d = geometry.duplicates(gdf)  # must not divide by zero
        assert d.exact == [[0, 1]]


@pytest.mark.unit
class TestOverlaps:
    """Boundary conflicts: two DIFFERENT fields sharing ground — not duplicates."""

    def test_partial_overlap_is_a_conflict_not_a_duplicate(self) -> None:
        d = geometry.duplicates(_gdf(_square(0, 0, 1.0), _square(0.5, 0, 1.0)))
        assert d.exact == [] and d.normalized == [] and d.near == []
        assert d.overlaps == [[0, 1]]

    def test_tiny_slivers_are_ignored(self) -> None:
        # 1% shared area is GPS noise, not a boundary dispute.
        d = geometry.duplicates(_gdf(_square(0, 0, 1.0), _square(0.99, 0, 1.0)))
        assert d.overlaps == []

    def test_near_duplicates_are_not_double_reported_as_overlaps(self, sample_gdf) -> None:
        d = geometry.duplicates(sample_gdf)
        assert d.near != []          # fid-4 pairs stay in the near tier
        assert d.overlaps == []      # and are not repeated here

    def test_report_carries_overlaps_through_to_its_output(self) -> None:
        from farmqa import report

        rep = report.build(_gdf(_square(0, 0, 1.0), _square(0.5, 0, 1.0)))
        assert rep.duplicates.overlaps == [[0, 1]]
