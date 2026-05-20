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

# Download the prebuilt street-graph pickle directly from the GitHub release.
# We ship the .pkl (not just the .graphml + an in-container bake) because the
# bake in fetch_street_graph.py is not bit-identical across platforms — float
# drift in the KDE / park-proximity steps diverges between Windows local and
# the Linux container, and the SEC-001 SHA-256 check requires byte equality
# with STREET_GRAPH_SHA256. Refresh procedure: rebuild locally with
# `python fetch_street_graph.py`, upload the new .pkl to the `street-graph`
# GitHub release (overwrite the asset), recompute STREET_GRAPH_SHA256, and
# update it in both backend/.env and Railway *before* pushing the code change.
RUN curl -fL -o street_graph_igraph.pkl \
    "https://github.com/AdamBHonaker/Passage/releases/download/street-graph/street_graph_igraph.pkl"

# Download the prebuilt geocoding SQLite + FTS5 indexes (~72 MB). Built locally
# from backend/scripts/build_address_points.py + build_intersections.py +
# migrate_geocode_cache.py; gitignored because of size. Without this file,
# local_search collapses to the 77 community-area centroids and every street
# address / intersection / curated POI query falls through to LocationIQ (or
# returns None if LOCATIONIQ_API_KEY is unset). Refresh procedure: rebuild
# locally with the scripts above, upload the new chicago_geocode.db to the
# `street-graph` GitHub release (overwrite), push.
RUN curl -fL -o data/chicago_geocode.db \
    "https://github.com/AdamBHonaker/Passage/releases/download/street-graph/chicago_geocode.db"

# Download the optional Chicago boundary polygon used by /explore to clip
# isochrones against Lake Michigan for lakefront origins. explore.py
# already handles the file being absent (skip clipping); we ship it so
# waterfront origins render correctly in prod. Built locally by
# backend/scripts/build_chicago_boundary.py; no integrity check (data, not
# pickled code). Refresh cadence: rarely — Chicago's boundary changes once
# a decade at most.
RUN curl -fL -o data/chicago_boundary.json \
    "https://github.com/AdamBHonaker/Passage/releases/download/street-graph/chicago_boundary.json"

# Expose the port FastAPI will run on
EXPOSE 8000

# Set environment variables
ENV PORT=8000
ENV HOST=0.0.0.0

# Run the FastAPI application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--log-level", "warning"]
