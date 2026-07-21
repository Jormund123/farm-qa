"""Integration tests for the API.

The endpoints are thin, so these check the wiring and the error mapping. The
geometry math is already covered by the core unit, property, and golden tests.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def _upload(sample_bytes: bytes):
    return client.post(
        "/api/files",
        files={"files": ("Farm_file.geojson", sample_bytes, "application/geo+json")},
    )


@pytest.mark.integration
class TestUpload:
    def test_upload_returns_qa(self, sample_bytes: bytes) -> None:
        r = _upload(sample_bytes)
        assert r.status_code == 200
        body = r.json()
        assert body["featureCount"] == 5
        assert body["qa"]["count"] == 5
        assert body["qa"]["had_z"] is True

    def test_multi_file_upload_merges(self, sample_bytes: bytes) -> None:
        r = client.post(
            "/api/files",
            files=[
                ("files", ("a.geojson", sample_bytes, "application/geo+json")),
                ("files", ("b.geojson", sample_bytes, "application/geo+json")),
            ],
        )
        assert r.json()["featureCount"] == 10

    def test_rejects_non_geojson_with_typed_error(self) -> None:
        r = client.post(
            "/api/files",
            files={"files": ("bad.txt", b"not json", "text/plain")},
        )
        assert r.status_code == 422
        assert r.json()["error"] == "GeoParseError"


@pytest.mark.integration
class TestRetrieve:
    def test_qa_and_features_roundtrip(self, sample_bytes: bytes) -> None:
        file_id = _upload(sample_bytes).json()["fileId"]

        qa = client.get(f"/api/files/{file_id}/qa").json()
        assert qa["count"] == 5

        fc = client.get(f"/api/files/{file_id}/features").json()
        assert fc["type"] == "FeatureCollection"
        assert len(fc["features"]) == 5

    def test_unknown_file_id_is_404(self) -> None:
        assert client.get("/api/files/nope/qa").status_code == 404

    def test_rows_carry_area_validity_and_duplicate_flags(self, sample_bytes: bytes) -> None:
        file_id = _upload(sample_bytes).json()["fileId"]
        rows = client.get(f"/api/files/{file_id}/rows").json()["rows"]
        assert len(rows) == 5
        by_fid = {int(r["properties"]["fid"]): r for r in rows}
        assert by_fid[5]["valid"] is False          # the invalid plot
        assert by_fid[1]["duplicate"] is True        # part of the identical set
        assert all(r["area_ha"] > 0 for r in rows)


@pytest.mark.integration
class TestReplaceFeatures:
    def test_put_replaces_collection_and_reruns_qa(self, sample_bytes: bytes) -> None:
        file_id = _upload(sample_bytes).json()["fileId"]
        fc = client.get(f"/api/files/{file_id}/features").json()
        fc["features"] = [f for f in fc["features"] if f["properties"]["fid"] in (1, 5)]

        r = client.put(f"/api/files/{file_id}/features", json=fc)
        assert r.status_code == 200
        body = r.json()
        assert body["featureCount"] == 2
        assert body["qa"]["count"] == 2
        assert body["qa"]["duplicates"]["exact"] == []  # duplicate partners removed

        # subsequent reads reflect the edit
        assert len(client.get(f"/api/files/{file_id}/features").json()["features"]) == 2

    def test_put_invalid_body_is_typed_422(self, sample_bytes: bytes) -> None:
        file_id = _upload(sample_bytes).json()["fileId"]
        r = client.put(f"/api/files/{file_id}/features", json={"type": "nope"})
        assert r.status_code == 422
        assert r.json()["error"] == "GeoParseError"

    def test_put_unknown_file_is_404(self) -> None:
        empty = {"type": "FeatureCollection", "features": []}
        assert client.put("/api/files/nope/features", json=empty).status_code == 404


@pytest.mark.integration
class TestFix:
    def test_fix_repairs_and_updates_qa(self, sample_bytes: bytes) -> None:
        file_id = _upload(sample_bytes).json()["fileId"]
        r = client.post(f"/api/files/{file_id}/fix").json()
        assert len(r["fixed"]) == 1  # the invalid plot (fid 5)
        assert r["fixed"][0]["repaired"] is True
        assert r["qa"]["invalid"] == []  # none remain


@pytest.mark.integration
class TestHardening:
    def test_mismatched_property_schemas_stay_json_safe(self) -> None:
        """Merging files with different columns creates NaN cells — those must
        serialize as null, not the invalid-JSON literal NaN that breaks browsers."""
        import json

        def fc(props: dict) -> bytes:
            return json.dumps({
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature", "properties": props,
                    "geometry": {"type": "Polygon",
                                 "coordinates": [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]},
                }],
            }).encode()

        r = client.post("/api/files", files=[
            ("files", ("a.geojson", fc({"fid": 1, "crop": "Coffee"}), "application/geo+json")),
            ("files", ("b.geojson", fc({"fid": 2, "region": "Cauca"}), "application/geo+json")),
        ])
        file_id = r.json()["fileId"]

        for path in ("rows", "features"):
            resp = client.get(f"/api/files/{file_id}/{path}")
            assert "NaN" not in resp.text, f"/{path} leaked NaN into JSON"

    def test_oversized_upload_rejected_with_typed_error(self) -> None:
        from api.main import MAX_UPLOAD_BYTES

        blob = b"0" * (MAX_UPLOAD_BYTES + 1)
        r = client.post("/api/files",
                        files={"files": ("huge.geojson", blob, "application/geo+json")})
        assert r.status_code == 413
        assert r.json()["error"] == "FileTooLarge"

    def test_qa_is_cached_per_dataset_version(self, sample_bytes: bytes) -> None:
        """Repeat reads must reuse the analysis; edits must invalidate it."""
        from unittest.mock import patch

        from farmqa import report

        file_id = _upload(sample_bytes).json()["fileId"]
        client.get(f"/api/files/{file_id}/qa")

        with patch.object(report, "build", wraps=report.build) as spy:
            client.get(f"/api/files/{file_id}/qa")
            client.get(f"/api/files/{file_id}/rows")
            assert spy.call_count == 0  # served from cache

            client.post(f"/api/files/{file_id}/fix")  # mutates -> invalidates
            client.get(f"/api/files/{file_id}/qa")
            assert spy.call_count >= 1
