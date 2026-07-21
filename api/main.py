"""FastAPI app: thin endpoints over farmqa, and it serves the built React UI.

Each endpoint reads the store, calls farmqa, and returns plain JSON. Geometry
errors turn into a typed JSON envelope, and every request is logged as one
JSON line.
"""
from __future__ import annotations

import dataclasses
import json
import logging
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from api import assistant, store
from farmqa import geometry, io, metrics, report

load_dotenv()  # GEMINI_API_KEY from .env (real env vars win)

log = logging.getLogger("farmqa")
logging.basicConfig(level=logging.INFO, format="%(message)s")

app = FastAPI(title="Farm GeoJSON QA Dashboard")
app.include_router(assistant.router)

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # reject beyond this with a typed 413


# One JSON log line per request.
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    log.info(json.dumps({
        "method": request.method,
        "path": request.url.path,
        "status": response.status_code,
        "ms": round((time.perf_counter() - start) * 1000, 1),
    }))
    return response


@app.exception_handler(io.GeoParseError)
async def _on_parse_error(request: Request, exc: io.GeoParseError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"error": "GeoParseError", "message": str(exc),
                 "hint": "Upload a valid GeoJSON FeatureCollection."},
    )


class UnknownFileError(Exception):
    """Requested fileId is not in the store (bad id, or the server restarted)."""


@app.exception_handler(UnknownFileError)
async def _on_unknown_file(request: Request, exc: UnknownFileError) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"error": "UnknownFile",
                 "message": "This dataset is no longer on the server "
                            "(the in-memory store was reset).",
                 "hint": "Upload the file again."},
    )


def _record(file_id: str) -> dict:
    try:
        return store.get(file_id)
    except KeyError:
        raise UnknownFileError(file_id)


def _qa(record: dict) -> dict:
    """QA report for the record, cached until the dataset changes."""
    cache = record.setdefault("cache", {})
    if "qa" not in cache:
        rep = report.build(record["gdf"], warnings=record["warnings"])
        cache["qa"] = dataclasses.asdict(rep)
    return cache["qa"]


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/files")
async def upload(files: list[UploadFile] = File(...)) -> dict:
    """Upload one or more GeoJSON files; they are merged into one dataset."""
    frames, warnings = [], []
    for f in files:
        data = await f.read()
        if len(data) > MAX_UPLOAD_BYTES:
            return JSONResponse(status_code=413, content={
                "error": "FileTooLarge",
                "message": f"{f.filename} exceeds the "
                           f"{MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.",
                "hint": "Split the file or filter features before uploading.",
            })
        gdf, warns = io.load(data)
        frames.append(gdf)
        warnings.extend(warns)
    merged = _merge(frames)
    file_id = store.put(merged, warnings)
    return {"fileId": file_id, "featureCount": len(merged),
            "qa": _qa(store.get(file_id))}


@app.get("/api/files/{file_id}/qa")
def get_qa(file_id: str) -> dict:
    return _qa(_record(file_id))


@app.get("/api/files/{file_id}/features")
def get_features(file_id: str) -> dict:
    return json.loads(_record(file_id)["gdf"].to_json())


@app.get("/api/files/{file_id}/rows")
def get_rows(file_id: str) -> dict:
    """Per-plot table rows with computed area + validity + duplicate flags.

    Flags are read from the cached QA report, so this never re-runs analysis.
    """
    record = _record(file_id)
    gdf = record["gdf"]
    qa = _qa(record)
    invalid = {i["index"] for i in qa["invalid"]}
    dups = qa["duplicates"]
    duplicate = {i for group in (*dups["exact"], *dups["normalized"], *dups["near"]) for i in group}
    geom_col = gdf.geometry.name

    rows = []
    for index, row in gdf.iterrows():
        props = {k: _clean(v) for k, v in row.items() if k != geom_col}
        rows.append({
            "index": int(index),
            "area_ha": round(metrics.area_ha(row[geom_col]), 2),
            "valid": index not in invalid,
            "duplicate": index in duplicate,
            "properties": props,
        })
    return {"rows": rows}


def _clean(value):
    """numpy scalars -> plain python; NaN (from mismatched schemas) -> None."""
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and value != value:
        return None
    return value


@app.put("/api/files/{file_id}/features")
def replace_features(file_id: str, payload: dict) -> dict:
    """Replace the collection after client-side editing; QA reruns on the result.

    Goes through io.load so edits get the exact same validation/normalization
    as an upload (FeatureCollection check, CRS, Z-flattening).
    """
    _record(file_id)
    gdf, warnings = io.load(json.dumps(payload).encode())
    store.set_gdf(file_id, gdf, warnings)
    return {"featureCount": len(gdf), "qa": _qa(store.get(file_id))}


@app.post("/api/files/{file_id}/fix")
def fix_geometries(file_id: str) -> dict:
    record = _record(file_id)
    fixed, changes = geometry.fix(record["gdf"])
    store.set_gdf(file_id, fixed)
    return {"fixed": [dataclasses.asdict(c) for c in changes], "qa": _qa(store.get(file_id))}


def _merge(frames: list[gpd.GeoDataFrame]) -> gpd.GeoDataFrame:
    if len(frames) == 1:
        return frames[0].reset_index(drop=True)
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=frames[0].crs)


# Serve the built React UI (if present) from the same origin — one container.
_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="ui")
