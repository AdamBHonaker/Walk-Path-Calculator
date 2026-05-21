"""
Shared Chicago Data Portal (Socrata/SODA) client for curated ingestion scripts.

Reads API credentials and per-dataset endpoint URLs from `backend/.env`:

    CHICAGO_DATA_PORTAL_API_KEY_ID
    CHICAGO_DATA_PORTAL_API_KEY_SECRET
    CDP_API_ENDPOINT_LIBRARIES
    CDP_API_ENDPOINT_POLICE_STATIONS
    CDP_API_ENDPOINT_FIRE_STATIONS
    CDP_API_ENDPOINT_Schools
    CDP_API_ENDPOINT_DIVVY
    CDP_API_ENDPOINT_PARKS
    CDP_API_ENDPOINT_LANDMARKS

Each `CDP_API_ENDPOINT_*` value is a classic SODA resource URL of the form
`https://data.cityofchicago.org/resource/<4x4-id>.json` — i.e. a GET endpoint
that accepts `$limit` / `$where` query params. The Socrata v3 `/api/v3/views`
POST form is NOT supported by this client.

Authentication uses HTTP Basic with key-id as username and key-secret as
password (the Socrata-recommended scheme for app tokens with key/secret
pairs). An unauthenticated request would still work for public datasets
but shares an anonymous rate limit; authenticating moves us to the
per-app quota and keeps refresh runs predictable.
"""

from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_DIR / ".env")

_KEY_ID_ENV = "CHICAGO_DATA_PORTAL_API_KEY_ID"
_KEY_SECRET_ENV = "CHICAGO_DATA_PORTAL_API_KEY_SECRET"


def _auth_header() -> dict[str, str]:
    key_id = os.getenv(_KEY_ID_ENV, "").strip()
    secret = os.getenv(_KEY_SECRET_ENV, "").strip()
    if not key_id or not secret:
        raise RuntimeError(
            f"Chicago Data Portal credentials missing: set {_KEY_ID_ENV} and "
            f"{_KEY_SECRET_ENV} in backend/.env (see backend/.env.example)."
        )
    token = base64.b64encode(f"{key_id}:{secret}".encode("utf-8")).decode("ascii")
    return {"Authorization": f"Basic {token}"}


def get_endpoint(endpoint_env: str) -> str:
    """Resolve a `CDP_API_ENDPOINT_*` env var to its URL, or raise."""
    url = os.getenv(endpoint_env, "").strip()
    if not url:
        raise RuntimeError(
            f"Chicago Data Portal endpoint missing: set {endpoint_env} in "
            f"backend/.env to the dataset's classic SODA URL "
            f"(https://data.cityofchicago.org/resource/<4x4-id>.json)."
        )
    return url


def fetch_rows(
    endpoint_env: str,
    *,
    limit: int = 5000,
    where: str | None = None,
    timeout: int = 60,
) -> list[dict[str, Any]]:
    """Fetch every row from the dataset behind `endpoint_env`.

    Sends a single classic-SODA GET with `$limit` (and `$where` when provided).
    Returns the JSON response as a list of row dicts. Raises `RuntimeError`
    if credentials or the endpoint env var are missing; lets `requests`
    raise for HTTP / network errors.
    """
    url = get_endpoint(endpoint_env)
    headers = _auth_header()
    params: dict[str, Any] = {"$limit": limit}
    if where:
        params["$where"] = where
    resp = requests.get(url, params=params, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.json()
