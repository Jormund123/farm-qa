# ---- Stage 1: build the React UI -------------------------------------------
FROM node:22-alpine AS ui
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Stage 2: Python runtime ------------------------------------------------
FROM python:3.13-slim
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY farmqa/ farmqa/
COPY api/ api/
COPY --from=ui /build/dist web/dist

# No secrets are baked in: GEMINI_API_KEY is passed at run time (docker -e).
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
