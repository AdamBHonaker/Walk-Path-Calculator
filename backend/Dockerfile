# Use official Python runtime as a parent image
FROM python:3.11.13-slim

# Set Python environment variables for optimal container behavior
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory in container
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# ── Prebuilt release artifacts ──────────────────────────────────────────────
# Fetch three assets from this repo's `street-graph` GitHub release tag, in a
# single layer:
#   street_graph_igraph.pkl   ~28 MB  pedestrian routing graph with greenest-
#                                     routing edge weights. Loaded by walking.py.
#                                     Shipped prebuilt (not baked in-container):
#                                     the bake is not bit-identical across
#                                     platforms and the SEC-001 hash check needs
#                                     byte equality.
#   data/chicago_geocode.db   ~72 MB  SQLite + FTS5 geocoding indexes, opened
#                                     read-only by local_search.py. Absent →
#                                     geocoding falls back to area centroids.
#   data/chicago_boundary.json        Chicago boundary polygon; /explore clips
#                                     lakefront isochrones against it. explore.py
#                                     tolerates it being absent.
# Build + refresh procedure for all three: CLAUDE.md "Greenest-routing graph
# release runbook".
#
# Layer-cache correctness: this `RUN` sits BEFORE `COPY . .` (OPT-027), so a
# code-only change does not invalidate the artifact layer — `COPY . .` and the
# layers downstream of it rebuild, but the ~100 MB curl is reused from cache.
# BuildKit keys a `RUN` layer on the command string alone, so a plain `curl`
# is never re-run just because a release asset was overwritten in place (which
# the runbook does on every refresh). ARTIFACT_REV is interpolated into the RUN
# below; bumping it (here or via a Railway build variable) changes the command
# string and forces a fresh download. Bump it whenever any asset above is
# re-uploaded — with the new layer order, `ARTIFACT_REV` is the **only** knob
# that busts the artifact-layer cache.
ARG ARTIFACT_REV=2026-05-23

# STREET_GRAPH_SHA256 also gates the pickle at build time. Railway feeds this
# ARG from the service variable of the same name; locally pass --build-arg or
# leave it empty. Empty → verification is skipped (mirrors walking.py's runtime
# "warn and load"). A mismatch fails the build — earlier and louder than the
# runtime degradation to haversine routing.
ARG STREET_GRAPH_SHA256

# `$base`, `$expected`, `$actual` are SHELL variables, expanded by /bin/sh at
# run time — they must NOT be backslash-escaped. Docker only substitutes its
# own ARG/ENV vars (`${ARTIFACT_REV}`, `${STREET_GRAPH_SHA256}` below); an
# undeclared `$base` is passed through to the shell untouched. Writing `\$base`
# instead makes Docker forward a literal backslash, and the shell then reads
# `\$` as an escaped (literal) `$` — so the variable never expands and curl
# gets the literal string "$base/..." as a hostname.
RUN set -eu; \
    echo "Fetching street-graph release artifacts (ARTIFACT_REV=${ARTIFACT_REV})"; \
    mkdir -p data; \
    base="https://github.com/AdamBHonaker/Passage/releases/download/street-graph"; \
    curl -fL -o street_graph_igraph.pkl    "$base/street_graph_igraph.pkl"; \
    curl -fL -o data/chicago_geocode.db    "$base/chicago_geocode.db"; \
    curl -fL -o data/chicago_boundary.json "$base/chicago_boundary.json"; \
    expected="$(printf '%s' "${STREET_GRAPH_SHA256}" | tr -d '[:space:]' | tr 'A-Z' 'a-z')"; \
    if [ -n "$expected" ]; then \
        actual="$(sha256sum street_graph_igraph.pkl | cut -d ' ' -f1)"; \
        [ "$actual" = "$expected" ] || { echo "ERROR: street_graph_igraph.pkl SHA-256 mismatch (expected $expected, got $actual)" >&2; exit 1; }; \
        echo "street_graph_igraph.pkl SHA-256 verified at build time"; \
    else \
        echo "STREET_GRAPH_SHA256 not set - skipping build-time pickle verification"; \
    fi

# Copy the rest of the application code. Sits AFTER the artifact fetch (OPT-027)
# so code-only changes don't invalidate the ~100 MB artifact layer's cache.
COPY . .

# Expose the port FastAPI will run on
EXPOSE 8000

# Set environment variables
ENV PORT=8000
ENV HOST=0.0.0.0

# Run the FastAPI application.
# `sh -c` so ${UVICORN_WORKERS:-2} is expanded by the shell (the JSON exec form
# does not interpolate env vars). `exec` then replaces sh with uvicorn so SIGTERM
# from the orchestrator reaches uvicorn directly. Override the worker count by
# setting UVICORN_WORKERS=N in the Railway service variables — the default fits
# the smallest 2-vCPU plan plus the per-worker pickle + STRtree footprint
# (~200-300 MB after CHUNK-07's eager warm-up).
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port 8000 --no-access-log --log-level warning --workers ${UVICORN_WORKERS:-2}"]
