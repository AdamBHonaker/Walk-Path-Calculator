# Railway deployment guide

This is the **operator-facing** runbook for deploying Passage to Railway. For artifact rebuild + SHA rotation, see [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md). For backup / disaster recovery, see [`DR.md`](DR.md).

> **Acceptance contract (TD-048).** Following this doc end-to-end on a fresh fork should produce a working Railway deploy without any out-of-band knowledge. If you hit a step that requires information not documented here, file a bug — the doc is the contract.

## What Railway runs

The Dockerfile at [`backend/Dockerfile`](../backend/Dockerfile) is the entire build. It:

1. Installs Python 3.11 + the `requirements.txt` packages.
2. Pulls three release artifacts (the pickle, the geocode DB, and the boundary polygon) from this repo's `street-graph` GitHub release tag in a single layer.
3. Verifies the pickle's SHA-256 if `STREET_GRAPH_SHA256` is set as a build arg (mismatch → build fails).
4. Copies the rest of the backend source.
5. Runs `uvicorn main:app` with `${UVICORN_WORKERS:-2}` workers.

[`backend/railway.toml`](../backend/railway.toml) configures the orchestration layer — healthcheck path/timeout and restart policy.

## Service variables Railway needs

Set these in **Settings → Variables** on the Railway service. Distinct from `backend/.env.example` because Railway has its own separate notions of "build-time only" (consumed in the Dockerfile, baked into the image) vs "runtime" (read by `uvicorn` after the container starts).

### Build-time only

Read by the Dockerfile during `docker build`. Changing them re-runs the build.

| Variable | Required? | Effect |
|---|---|---|
| `ARTIFACT_REV` | Recommended | Bust the artifact-fetch layer's BuildKit cache when the GitHub release assets are re-uploaded. Format: a date string (`2026-05-24`). Bump whenever you re-upload `.pkl` / `.db` / `chicago_boundary.json`. **Forgetting this ships stale bytes** even after a successful re-upload (TD-050 added a guard against this). |
| `STREET_GRAPH_SHA256` | Recommended in production | Expected SHA-256 of the freshly-downloaded `street_graph_igraph.pkl`. When set, the build verifies the digest and fails on mismatch — earlier and louder than the runtime degradation. Leave unset to skip the verification (logs a warning at boot instead of failing the build). Rotate whenever you re-bake the pickle. |

### Runtime

Read by `uvicorn` / `main.py` / `geocoding.py` after the container starts. Changing them triggers a redeploy without a rebuild.

| Variable | Required? | Effect |
|---|---|---|
| `STREET_GRAPH_SHA256` | Recommended in production | Same value as the build-time arg above, also read at runtime so `walking.py` re-verifies the pickle on every container start. Belt-and-braces protection against a layer-cache mismatch. |
| `ALLOWED_ORIGINS` | Yes (production) | Comma-separated CORS allowlist. Set to the frontend's deployed origin, e.g. `https://wayfarer-passage.vercel.app`. Localhost origins are always allowed. |
| `TRUST_PROXY_HEADERS` | Yes (production) | `"true"` to honor `X-Forwarded-Proto` and issue HSTS for proxied-HTTPS requests. Required on Railway because the platform terminates TLS upstream of the container. |
| `TRUSTED_PROXY_HOPS` | Yes (production) | Integer; the number of trusted reverse proxies in front of the service. Typically `1` (Railway's edge alone) or `2` (Cloudflare → Railway). The rate limiter reads the client IP from `X-Forwarded-For` at this depth, counted from the right. Padding the value lets clients spoof the rate-limit key. |
| `LOCATIONIQ_API_KEY` | Optional | Hosted geocoder fallback for free-text addresses that miss every local tier. Without it, free-text queries that miss locally return `None`. Free tier = 5k requests/day. |
| `UVICORN_WORKERS` | Optional | Worker process count. Defaults to `2` (fits Railway's smallest 2 vCPU plan with per-worker pickle + STRtree footprint ~200-300 MB after lifespan warm-up). Multiply against the plan ceiling. |
| `RATE_LIMIT_ENABLED` | Optional | Set to `"false"` to disable the per-IP limiter (test fixtures use this — not for production). |
| `GRAPH_EVICTION_TTL_SECONDS` | Optional | Idle-time after which the cached street graph evicts. Default `3600` (1 hour). Set to `0` to disable (logs a notice on boot — TD-056). |
| `STRUCTURED_LOGS` | Optional | `"true"` swaps uvicorn's text logs for JSON via `python-json-logger` (TD-069). Set in production for log-aggregator ingestion. |

### Should NOT be set in production

The following exist for local dev / specific tooling and **must remain unset in Railway**:

| Variable | Why not |
|---|---|
| `APP_ENV` | Only `dev` / `development` / `local` values gate `DEV_TUNNEL_ORIGIN_REGEX`. Any non-dev value (including unset) refuses the regex — keep it that way. |
| `DEV_TUNNEL_ORIGIN_REGEX` | Widens CORS to a third-party-owned domain (`*.trycloudflare.com`). Dev-tunnel-only; never production. |
| `CHICAGO_DATA_PORTAL_API_KEY_*` + `CDP_API_ENDPOINT_*` | Ingestion-only; the runtime never reads these. Setting them in Railway leaks credentials into the production env. |

## First-deploy checklist

1. **Fork the repo** + create a new Railway service from the fork.
2. **Tell Railway to use the `backend/` directory.** Service Settings → Source → set the root directory. Otherwise Railway searches the repo root for a Dockerfile and fails the build.
3. **Set the build-time + production runtime variables** from the tables above. `LOCATIONIQ_API_KEY` is optional; everything else marked "Required" must be set before the first deploy.
4. **Compute the pickle hash locally and set `STREET_GRAPH_SHA256`** in both build-time and runtime variables. Skip if you want the warn-and-load fallback, but production deploys should pin the hash. See [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md) for the rotate procedure.
5. **Deploy.** First build takes ~3-5 min (the artifact fetch + Python deps + uvicorn cold start). The `/health` healthcheck has a 90 s grace window for the lifespan handler.
6. **Verify the public URL** by hitting `/health`. Should return `{"status": "ok"}`. If `feature_degraded` is present, see TD-068 in [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) for the recovery path.

## When a deploy fails to come up

- **`SHA-256 mismatch`** in the build log → the GitHub release pickle was re-uploaded but `STREET_GRAPH_SHA256` wasn't rotated. See [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md) "Pickle integrity check."
- **Container starts but `/health` returns 502** → the lifespan handler is still warming the graph. Wait 60-90 s. If it persists, tail the container logs for `Refusing to load` (SEC-001 mismatch) or `Preloading street graph` hangs.
- **`/route` returns 500 with "no route found"** → check `/health.feature_degraded` for missing graph columns (TD-068). A v2 pickle missing canopy/park columns now boots with graceful degradation — greenest will still route but emit footway-only discount.

## Cost notes

- Each uvicorn worker keeps its own pickle + STRtree set resident (~200-300 MB after warm-up). On the smallest Railway plan (512 MB RAM) you'll OOM with the default 2 workers — drop to `UVICORN_WORKERS=1` or upgrade the plan.
- The artifact download is ~100 MB (mostly `chicago_geocode.db`). It bypasses Railway's outbound bandwidth limits because it's pulled during the build, not at runtime.
