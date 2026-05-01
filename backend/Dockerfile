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

# Download the street graph and build the fast igraph artifact from it
RUN curl -fL -o street_graph.graphml \
    "https://github.com/AdamBHonaker/Walk-Path-Calculator/releases/download/street-graph/street_graph.graphml" \
    && python fetch_street_graph.py

# Expose the port FastAPI will run on
EXPOSE 8000

# Set environment variables
ENV PORT=8000
ENV HOST=0.0.0.0

# Run the FastAPI application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--log-level", "warning"]
