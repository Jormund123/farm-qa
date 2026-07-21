"""Shared pytest fixtures."""
from __future__ import annotations

from pathlib import Path

import pytest

DATA_DIR = Path(__file__).parent / "data"


@pytest.fixture
def sample_path() -> Path:
    """Path to the real client file (Farm_file.geojson)."""
    return DATA_DIR / "Farm_file.geojson"


@pytest.fixture
def sample_bytes(sample_path: Path) -> bytes:
    """Raw bytes of the real client file, as uploaded through the dashboard."""
    return sample_path.read_bytes()
