# web/ — React + TypeScript (Vite) frontend

Populated at **build-order step 7** (`npm create vite@latest`). Thin UI over the
`/api/*` endpoints: upload → QA summary card → table → map → edit → assistant chat.

Build output (`web/dist`) is copied into the Docker image and served by FastAPI —
one container, one port.
