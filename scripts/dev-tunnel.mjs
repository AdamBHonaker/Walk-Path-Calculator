#!/usr/bin/env node
// Dev orchestrator: runs uvicorn + Vite behind two ephemeral Cloudflare tunnels
// so a real phone (iOS Safari especially) can hit the dev app over HTTPS and
// exercise PWA install, geolocation, share, and the share-card download flow.
//
// Both backend and frontend are tunneled because a CORS-permitted phone request
// would otherwise hit the *phone's* localhost. The dev backend is briefly
// internet-reachable for the session — see docs/MOBILE_TESTING.md for the
// security caveat. Do not run this against a backend/.env that holds prod keys.
//
// Cleanup: SIGINT/SIGTERM tears down all four child processes and removes
// frontend/.env.local so a subsequent `npm run dev` doesn't pick up a stale
// tunnel URL.

import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve cloudflared even when PATH wasn't refreshed after a `winget install`
// (common pitfall: the install updates the system PATH, but already-open
// shells inherit the old one). Falls back to the standard winget/brew paths.
function resolveCloudflaredCmd() {
  const fallbacks = process.platform === "win32"
    ? [
        "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
        "C:\\Program Files\\cloudflared\\cloudflared.exe",
      ]
    : [
        "/opt/homebrew/bin/cloudflared",
        "/usr/local/bin/cloudflared",
      ];
  for (const candidate of fallbacks) {
    if (existsSync(candidate)) return candidate;
  }
  return "cloudflared"; // hope PATH has it
}
const CLOUDFLARED_CMD = resolveCloudflaredCmd();

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const repoRoot   = path.resolve(__dirname, "..");
const frontendDir = path.join(repoRoot, "frontend");
const backendDir  = path.join(repoRoot, "backend");
const envLocalPath = path.join(frontendDir, ".env.local");

const BACKEND_PORT  = 8000;
const FRONTEND_PORT = 5173;
const TUNNEL_HOST_PATTERN = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
const TUNNEL_ORIGIN_REGEX = "^https://[a-z0-9-]+\\.trycloudflare\\.com$";

const children = [];
let cleanedUp = false;

function log(tag, msg) {
  process.stdout.write(`[${tag}] ${msg}\n`);
}

function track(child, name) {
  children.push({ child, name });
  child.on("exit", (code, signal) => {
    if (!cleanedUp) {
      log(name, `exited (code=${code}, signal=${signal}) — shutting down siblings`);
      cleanup(1);
    }
  });
}

function cleanup(exitCode = 0) {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const { child, name } of children) {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill("SIGINT");
        log(name, "stopping");
      } catch {}
    }
  }
  if (existsSync(envLocalPath)) {
    try { unlinkSync(envLocalPath); log("clean", "removed frontend/.env.local"); } catch {}
  }
  setTimeout(() => process.exit(exitCode), 500);
}

process.on("SIGINT",  () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

function spawnTunnel(name, localUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLOUDFLARED_CMD, ["tunnel", "--url", localUrl, "--no-autoupdate"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    track(child, name);

    let resolved = false;
    const onData = (buf) => {
      const text = buf.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && !resolved) {
        resolved = true;
        resolve(match[0]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      if (!resolved) {
        if (err.code === "ENOENT") {
          reject(new Error(
            "cloudflared is not installed or not on PATH. Install it: " +
            "`winget install cloudflare.cloudflared` (Windows), " +
            "`brew install cloudflare/cloudflare/cloudflared` (macOS), " +
            "or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
          ));
        } else {
          reject(err);
        }
      }
    });
    setTimeout(() => {
      if (!resolved) reject(new Error(`${name}: cloudflared did not print a URL within 30s`));
    }, 30_000);
  });
}

function spawnBackend() {
  const env = {
    ...process.env,
    DEV_TUNNEL_ORIGIN_REGEX: TUNNEL_ORIGIN_REGEX,
    // APP_ENV=development is the dev-only marker the backend requires before
    // honoring DEV_TUNNEL_ORIGIN_REGEX. Without it, the backend logs an error
    // and refuses the regex (anti-footgun for a stray .env that happens to
    // carry the var). Set it here so the dev-tunnel flow keeps working.
    APP_ENV: process.env.APP_ENV || "development",
  };
  // Invoke uvicorn via `python -m uvicorn` so this works whether or not
  // Python's user-site Scripts directory is on PATH. The `python` binary
  // itself must be on PATH (or activate your venv before running).
  const pythonCmd = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const child = spawn(
    pythonCmd,
    ["-m", "uvicorn", "main:app", "--reload", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)],
    { cwd: backendDir, stdio: "inherit", env },
  );
  track(child, "backend");
  return child;
}

function spawnFrontend() {
  // Spawn vite's JS entry directly with the running Node binary instead of
  // going through npm.cmd. Two reasons: (1) Node ≥ 20 on Windows refuses to
  // spawn .cmd files without shell:true (CVE-2024-27980 hardening) and
  // throws EINVAL; (2) skipping the npm wrapper avoids one extra process and
  // a deprecation warning. Mirrors what `npm run dev` does internally.
  const viteEntry = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(viteEntry)) {
    throw new Error(
      `vite entry not found at ${viteEntry} — run \`npm install\` in frontend/ first.`
    );
  }
  const child = spawn(
    process.execPath,
    [viteEntry, "--port", String(FRONTEND_PORT)],
    { cwd: frontendDir, stdio: "inherit" },
  );
  track(child, "frontend");
  return child;
}

async function main() {
  log("dev-tunnel", "starting backend (uvicorn)…");
  spawnBackend();

  // Give uvicorn a head start so the backend tunnel handshake doesn't 502 on
  // the first probe. cloudflared retries, so this is just a politeness window.
  await new Promise((r) => setTimeout(r, 1500));

  log("dev-tunnel", "opening backend tunnel…");
  const backendUrl = await spawnTunnel("tunnel-backend", `http://localhost:${BACKEND_PORT}`);
  if (!TUNNEL_HOST_PATTERN.test(backendUrl)) {
    throw new Error(`Unexpected backend tunnel URL: ${backendUrl}`);
  }
  log("dev-tunnel", `backend  → ${backendUrl}`);

  writeFileSync(envLocalPath, `VITE_BACKEND_URL=${backendUrl}\n`, "utf8");
  log("dev-tunnel", `wrote ${path.relative(repoRoot, envLocalPath)}`);

  log("dev-tunnel", "starting frontend (vite)…");
  spawnFrontend();
  await new Promise((r) => setTimeout(r, 1500));

  log("dev-tunnel", "opening frontend tunnel…");
  const frontendUrl = await spawnTunnel("tunnel-frontend", `http://localhost:${FRONTEND_PORT}`);
  log("dev-tunnel", `frontend → ${frontendUrl}`);

  process.stdout.write([
    "",
    "──────────────────────────────────────────────────────────────",
    "  Open this on your phone (HTTPS, real device, no LAN required):",
    "",
    `    ${frontendUrl}`,
    "",
    `  Backend:  ${backendUrl}`,
    "",
    "  Press Ctrl-C to stop everything and remove frontend/.env.local.",
    "──────────────────────────────────────────────────────────────",
    "",
  ].join("\n"));
}

main().catch((err) => {
  log("dev-tunnel", `fatal: ${err.message}`);
  cleanup(1);
});
