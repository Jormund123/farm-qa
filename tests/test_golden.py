"""Golden snapshot of the QAReport for the sample file.

Pins the whole core's output so a regression shows up as a diff. Regenerate on
purpose with ``python -m tests.gen_golden``, only when the change is expected.
"""
from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from farmqa import io, report

GOLDEN = Path(__file__).parent / "data" / "golden_qa.json"


@pytest.mark.integration
def test_qa_report_matches_golden(sample_bytes: bytes) -> None:
    gdf, warnings = io.load(sample_bytes)
    got = dataclasses.asdict(report.build(gdf, warnings=warnings))
    expected = json.loads(GOLDEN.read_text())
    assert got == expected
