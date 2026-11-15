# VoxCrew (free edition) — Docker image. One command: docker compose up --build  ->  http://localhost:7420
# Stage 1 builds the UI, stage 2 is the Python server. No secrets, no build args.
FROM node:20-slim AS ui
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
# vite.config.ts -> scripts/build-info.mjs: git is optional (no .git in the build context; commit is recorded as null)
RUN npm run build

FROM python:3.12-slim AS app
RUN pip install --no-cache-dir "uv~=0.8.0"
RUN useradd --system --create-home --uid 10001 voxcrew \
 && mkdir -p /app/backend /data && chown -R voxcrew:voxcrew /app /data
USER voxcrew
WORKDIR /app/backend
ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PATH="/app/backend/.venv/bin:$PATH"
# dependencies first (cached layer), then the source; the project stays editable so ROOT resolves to /app
COPY --chown=voxcrew:voxcrew backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY --chown=voxcrew:voxcrew backend/studio ./studio
COPY --chown=voxcrew:voxcrew backend/ontology ./ontology
RUN uv sync --locked --no-dev
COPY --chown=voxcrew:voxcrew workflows /app/workflows
COPY --from=ui --chown=voxcrew:voxcrew /src/frontend/dist /app/frontend/dist

# Listens on 0.0.0.0 INSIDE the container only; docker-compose.yml publishes it on the host's 127.0.0.1 alone.
# VOXCREW_CONTAINER=1 is what allows STUDIO_BIND_HOST at all (backend/studio/main.py bind_host).
ENV VOXCREW_CONTAINER=1 STUDIO_BIND_HOST=0.0.0.0 STUDIO_PORT=7420 STUDIO_DATA_DIR=/data HERMES_HOME=/data/hermes \
    STUDIO_BUILD_CHECKED=1 PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 7420
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:7420/api/meta/build', timeout=4)"]
ENTRYPOINT ["voxcrew"]
CMD ["--port", "7420"]
