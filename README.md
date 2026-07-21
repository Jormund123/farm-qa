# Farm plot QA

Automated quality control for farm plot boundaries stored as GeoJSON. It reads
a file of plots, checks each one for the faults a person would otherwise look
for by hand, measures the true area, repairs broken shapes, and answers
questions about the data. The dashboard is how you drive it and see the result.

Built as a take-home for the GRAS "Automation Student Assistant – GIS &
Sustainability" role. Part A is the checks plus the dashboard; Part B is an
assistant that can only answer from those checks.

## Run it

You need Docker running.

```bash
# option 1: load the delivered image
docker load -i farm-qa.tar
docker run --rm -p 8000:8000 farm-qa

# option 2: build it from source
docker build -t farm-qa .
docker run --rm -p 8000:8000 farm-qa
```

Open http://localhost:8000 and upload `tests/data/Farm_file.geojson`. Stop with
`Ctrl+C`.

Part B (the chat assistant) needs a Google Gemini API key. Everything else runs
without one; the chat window just says it is not configured. Pass the key at run
time:

```bash
docker run --rm -p 8000:8000 -e GEMINI_API_KEY=your_key farm-qa
```

The key is passed in at run time and never baked into the image, so the `.tar`
carries no secret.

To run the tests, see "Running it locally" near the end.

## Try it

The sample file was built to trigger every check. Upload it, then:

1. The summary shows 5 plots, their total area, and how many are invalid or
   duplicated. All of it was computed on upload with no manual step.
2. The table lists each plot with its area and status. Double-click a cell to
   edit an attribute.
3. The map draws the plots. Click a table row or a pin to fly to that plot.
4. The issues panel groups what the checks found: one invalid geometry (a hole
   outside its ring) and several duplicate groups.
5. Press "Fix all" to repair the invalid geometry; the table, map, and counts
   update because the checks re-run.
6. Open the chat (bottom right) and ask "how many plots are duplicates?" or
   "fix the invalid geometry". Each answer lists the checks it ran.

## What it checks for, and why that matters

Plot files arrive messy, and the faults are the kind a human misses when
scanning hundreds of shapes:

- Broken shapes. A boundary that crosses itself, or a hole placed outside its
  plot, is invalid geometry. Left in, it corrupts area totals and breaks
  spatial queries downstream. These are caught and can be repaired.
- The same field recorded more than once. This happens three ways in practice,
  so one equality test is not enough: a byte-identical copy, the same shape
  with its points saved in a different order, and a re-digitized near-copy whose
  boundary agrees by 98% or more. Each is detected separately.
- Two different fields claiming the same ground. When distinct plots share at
  least 5% of the smaller one's area, that is a boundary dispute, not a copy,
  and it is reported on its own so it does not hide among the duplicates.
- Wrong area. A plot's stored size should match its shape. The area is measured
  on the curved surface of the Earth so the hectares are real, which is what
  lets you spot a declared size that does not match the boundary.

## How it is built, and the choices behind it

The work went in phases, and each choice below was the option that held up once
the others were ruled out.

### The checks live in one place, and everything else is a wrapper

All the geometry logic sits in a small Python library (`farmqa`) with no web or
AI code in it. The HTTP API, the browser dashboard, and the chat assistant are
three ways to reach the same functions.

```
  You, in a browser
        │   upload a GeoJSON file of plots
        ▼
  Dashboard              table · map · issues · chat
        │   HTTP
        ▼
  API (FastAPI)          loads the file, holds it in memory,
        │                serves the dashboard and the JSON
        │   calls
        ▼
  Checks (farmqa)        run automatically on every plot:
        │                  · is the shape valid?
        │                  · is it a duplicate of another plot?
        │                  · does it overlap a neighbour it shouldn't?
        │                  · how many hectares, measured on the globe?
        ▼
  Report                 numbers, flags, and map colours
        │
        └──────────────► back to the dashboard
```

The reason is reuse. The assistant has to give the same answer as the
dashboard, and the dashboard has to agree with the raw API. If the logic lived
in the React code or in the endpoints, the assistant could not call it, and
three copies would drift apart. One tested library means one answer, and it is
the only place that needs correctness tests.

### Area is measured on a globe, not on a flat map

GeoJSON coordinates are longitude and latitude in degrees. Asking a library for
the "area" of a shape in degrees returns a number that means nothing on the
ground. The usual fix is to reproject into a metre-based coordinate system, but
that means picking the right local zone for every file, and farm data can sit
anywhere. Instead the area is computed directly on the WGS84 ellipsoid
(`pyproj.Geod`), which is correct anywhere on Earth without choosing a zone. For
global plot data there was no cleaner option.

### Duplicate detection is tiered and uses a spatial index

Because the same field shows up three different ways, the check runs three
tiers: a hash for exact copies, a hash of the normalized shape for reordered
points, and an area-overlap test for near-copies. The overlap test is the
expensive one, so it queries an R-tree (`STRtree`) and only compares plots whose
bounding boxes actually touch. That keeps it fast on large files. Comparing
every plot against every other would stall once a real file arrives.

### A conflict is kept separate from a duplicate

Two plots that overlap a little are not the same field twice; they are a real
disagreement about where a boundary sits. Folding that into the duplicate count
would bury a problem an operator needs to see, so it gets its own tier and its
own colour on the map.

### The assistant repeats the checks, it does not reason on its own

A language model asked about your data will happily invent a number. So the
model here is never the source of truth. It turns a question into a call to one
of the checks, reads the result, and answers from that, and it is not allowed to
state a fact it did not read from a check. Every reply comes back as a fixed
JSON shape that the server validates before showing it, so the output is
structured and checkable rather than free prose. The design and the production
risks are written up in `docs/agentic-ai.md`.

### It ships as one container

The UI is compiled and served by the same process as the API, so there is a
single thing to run and no cross-origin setup. Uploaded files are kept in memory
rather than a database, which suits a take-home and keeps the checker from
having to stand up PostGIS. That is a deliberate limit, noted at the end, and
the dashboard recovers cleanly when the store is cleared by a restart.

## Layout

```
farmqa/          the checks, with no web framework
  io.py          read and normalise GeoJSON
  metrics.py     hectare area on the globe
  geometry.py    validity, repair, duplicate and overlap detection
  report.py      assembles one report object, the single source of truth
api/             FastAPI over farmqa; also serves the built UI
  main.py        upload, qa, rows, features, edit, fix endpoints
  assistant.py   Part B chat: the model calls the checks as tools
  store.py       in-memory store of uploaded files
web/             React dashboard (Vite, Leaflet map, TanStack table)
tests/           60 tests, including a golden snapshot of the sample file
docs/            agentic-ai.md — Part B design and production risks
Dockerfile       builds UI and backend into one image
```

The HTTP endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/health` | liveness |
| POST | `/api/files` | upload a GeoJSON file |
| GET  | `/api/files/{id}/qa` | the quality report |
| GET  | `/api/files/{id}/rows` | table rows with flags |
| GET  | `/api/files/{id}/features` | the plots as GeoJSON |
| PUT  | `/api/files/{id}/features` | save edits, re-run checks |
| POST | `/api/files/{id}/fix` | repair invalid geometries |
| POST | `/api/files/{id}/assistant` | ask the assistant |

## Running it locally

Backend:

```bash
pip install -r requirements.txt
uvicorn api.main:app --reload      # http://localhost:8000
pytest                             # 60 tests
```

Frontend, in a second terminal:

```bash
cd web
npm install
npm run dev                        # http://localhost:5173
```

Put `GEMINI_API_KEY=your_key` in a `.env` file at the project root to enable the
assistant locally. `.env` is ignored by git and by Docker.

## Limits and what would come next

Uploaded files live in memory, so a restart clears them; the UI notices and
returns you to the upload screen. Production would move this to a spatial
database such as PostGIS. Uploads are capped at 25 MB, and past roughly 50,000
plots the map would need vector tiles instead of drawing every shape. The
basemap tiles are fetched over the internet, so the map needs a connection. The
assistant's remaining risks and their production fixes are in
`docs/agentic-ai.md`.
