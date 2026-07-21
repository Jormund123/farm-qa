"""Smoke test: the package imports and the sample data is where it should be."""
from __future__ import annotations

import pytest

import farmqa
from farmqa import geometry, io, metrics, report


@pytest.mark.unit
def test_core_package_imports() -> None:
    assert farmqa.__version__
    # the public entry points are all present
    assert callable(io.load)
    assert callable(metrics.area_ha)
    assert callable(geometry.duplicates)
    assert callable(report.build)


@pytest.mark.unit
def test_qareport_contract() -> None:
    r = report.QAReport()
    assert r.count == 0
    assert r.area_method.startswith("geodesic")
    assert r.duplicates.exact == []


@pytest.mark.unit
def test_sample_data_present(sample_bytes: bytes) -> None:
    assert sample_bytes.startswith(b"{")
    assert b"FeatureCollection" in sample_bytes
