// TD-071: localStorage schema versioning + migration registry.
//
// Why this exists. Every `walkpath:*` key the app writes lives indefinitely
// on the user's machine. A future field rename (`avoidStairs` →
// `avoid_stairs`, say) or shape change (string-keyed → array-of-objects)
// needs a deliberate migration path; without one, old shapes either
// pollute new keys or get silently dropped by the next load + sanitize
// pass. The one schema change shipped to date — `train_stations` →
// `el_train_stations` — was hand-coded inside `explorePrefs.js:sanitize`
// (PV-009 followup). Future renames will accumulate as ad-hoc fixes
// scattered across whichever module owns the affected key.
//
// What it does. Maintains a single `walkpath:schemaVersion` integer key
// that the app reads on startup, compares against `CURRENT_SCHEMA_VERSION`
// below, and walks the registered migrations to bring it forward. Each
// migration is an idempotent function `(): void` that does whatever
// localStorage surgery the schema change requires; the runner persists
// the new version after each successful step so a crash mid-chain
// resumes from the last completed migration.
//
// Adding a migration. Bump `CURRENT_SCHEMA_VERSION` to N+1, add a
// `[N]: () => { ... }` entry to `MIGRATIONS`, and document the change in
// the doc comment for that entry. The migration runs once per user
// device; subsequent reloads find `schemaVersion >= N+1` and skip it.

import { safeGet, safeSet } from "./storage.js";

const SCHEMA_VERSION_KEY = "walkpath:schemaVersion";

// Bump this when adding a migration.
export const CURRENT_SCHEMA_VERSION = 1;

// Migrations. Keyed by the version they upgrade *from* — i.e. `MIGRATIONS[1]`
// runs against a v1 store and produces a v2 store. The runner walks
// `from = currentVersion` and applies every `MIGRATIONS[from]` until
// `from === CURRENT_SCHEMA_VERSION`.
//
// Each migration must be:
//   - **Idempotent** — running it twice is safe.
//   - **Crash-safe** — partial completion + restart should not corrupt.
//   - **Defensive** — read every key through the safe* helpers; treat
//     missing / malformed shapes as "nothing to migrate" rather than
//     throwing.
const MIGRATIONS = {
  // Example for future maintainers — uncomment and adapt:
  //
  // [1]: () => {
  //   // v1 → v2: rename `walkpath:explorePrefs.someField` to `newField`.
  //   const raw = safeGet("walkpath:explorePrefs");
  //   if (!raw) return;
  //   try {
  //     const data = JSON.parse(raw);
  //     if (data && typeof data === "object" && "someField" in data) {
  //       data.newField = data.someField;
  //       delete data.someField;
  //       safeSet("walkpath:explorePrefs", JSON.stringify(data));
  //     }
  //   } catch { /* malformed JSON — leave it for the next load's sanitize */ }
  // },
};

function readCurrentVersion() {
  const raw = safeGet(SCHEMA_VERSION_KEY);
  if (raw == null) {
    // First boot or pre-versioning install. Treat as v1 — the existing
    // shapes the app reads today are the v1 baseline. We persist the
    // marker immediately so subsequent boots short-circuit.
    return 1;
  }
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Run any pending migrations to bring localStorage up to
 * `CURRENT_SCHEMA_VERSION`. Safe to call multiple times — successful
 * runs short-circuit. Call once per app boot, before any storage
 * consumer reads.
 *
 * Returns the resulting version (also persisted to localStorage).
 */
export function runStorageMigrations() {
  let current = readCurrentVersion();
  while (current < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS[current];
    if (typeof migration !== "function") {
      // Gap in the registry — fail loud in dev, give up gracefully in
      // prod. A gap means a maintainer bumped CURRENT_SCHEMA_VERSION
      // without adding the matching migration entry. Uses Vite's
      // `import.meta.env.DEV` rather than `process.env.NODE_ENV` because
      // the browser bundle doesn't define `process`.
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          `[storageSchema] no migration registered for v${current} → v${current + 1}; ` +
          "skipping to current version. Add the migration entry to MIGRATIONS.",
        );
      }
      current = CURRENT_SCHEMA_VERSION;
      break;
    }
    try {
      migration();
    } catch (err) {
      // A migration crashed. Don't advance — leave the user on the
      // older version so the next boot retries. Log loudly so the
      // dev sees the failure.
      // eslint-disable-next-line no-console
      console.error(`[storageSchema] migration v${current} → v${current + 1} failed:`, err);
      return current;
    }
    current += 1;
    safeSet(SCHEMA_VERSION_KEY, String(current));
  }
  // Persist even when no migrations ran so a fresh install lands with
  // the version marker present.
  safeSet(SCHEMA_VERSION_KEY, String(current));
  return current;
}
