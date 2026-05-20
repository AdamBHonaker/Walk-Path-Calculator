# Use official Python runtime as a parent image
FROM python:3.11-slim

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

# Copy the rest of the application code
COPY . .

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
# Cache correctness: BuildKit keys a `RUN` layer on the command string alone,
# so a plain `curl` is never re-run just because a release asset was overwritten
# in place (which the runbook does on every refresh) — a warm cache would ship
# stale bytes. ARTIFACT_REV is interpolated into the RUN below; bumping it (here
# or via a Railway build variable) changes the command string and forces a
# fresh download. Bump it whenever any asset above is re-uploaded.
ARG ARTIFACT_REV=2026-05-20

# STREET_GRAPH_SHA256 also gates the pickle at build time. Railway feeds this
# ARG from the service variable of the same name; locally pass --build-arg or
# leave it empty. Empty → verification is skipped (mirrors walking.py's runtime
# "warn and load"). A mismatch fails the build — earlier and louder than the
# runtime degradation to haversine routing.
ARG STREET_GRAPH_SHA256

RUN set -eu; \
    echo "Fetching street-graph release artifacts (ARTIFACT_REV=${ARTIFACT_REV})"; \
    base="https://github.com/AdamBHonaker/Passage/releases/download/street-graph"; \
    curl -fL -o street_graph_igraph.pkl    "\$base/street_graph_igraph.pkl"; \
    curl -fL -o data/chicago_geocode.db    "\$base/chicago_geocode.db"; \
    curl -fL -o data/chicago_boundary.json "\$base/chicago_boundary.json"; \
    expected="\$(printf '%s' "${STREET_GRAPH_SHA256}" | tr -d '[:space:]' | tr 'A-Z' 'a-z')"; \
    if [ -n "\$expected" ]; then \
        actual="\$(sha256sum street_graph_igraph.pkl | cut -d ' ' -f1)"; \
        [ "\$actual" = "\$expected" ] || { echo "ERROR: street_graph_igraph.pkl SHA-256 mismatch (expected \$expected, got \$actual)" >&2; exit 1; }; \
        echo "street_graph_igraph.pkl SHA-256 verified at build time"; \
    else \
        echo "STREET_GRAPH_SHA256 not set - skipping build-time pickle verification"; \
    fi

# Expose the port FastAPI will run on
EXPOSE 8000

# Set environment variables
ENV PORT=8000
ENV HOST=0.0.0.0

# Run the FastAPI application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--log-level", "warning"]
