// TD-060 / F-32: the `WF` object in primitives.jsx exports CSS custom
// property references (`"var(--ink)"`) that are used in inline styles
// across the codebase. The tokens themselves are declared in tokens.css.
// Renaming `--ink` in tokens.css without updating the WF object would
// silently break every component that imports from WF — the inline
// `style={{ color: WF.ink }}` reference would emit `var(--ink)` for a
// token that no longer exists, and the browser would just paint with
// the unset fallback.
//
// This test extracts every `var(--*)` reference from the WF map and
// confirms each one is declared somewhere in tokens.css. New tokens can
// land freely; the test only catches the dangerous direction of drift
// (WF references a name tokens.css no longer declares).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { WF } from "./primitives.jsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(path.join(__dirname, "tokens.css"), "utf8");

// Pull every `--foo:` declaration out of tokens.css. Matches both the
// `:root`-scoped defaults and the `.theme-dusk`-scoped overrides — either
// declaration site is sufficient to keep the token alive.
const declaredTokens = new Set(
  Array.from(tokensCss.matchAll(/(--[\w-]+)\s*:/g), m => m[1]),
);

// Pull every `var(--foo)` reference out of the WF map.
const referencedTokens = new Set();
for (const value of Object.values(WF)) {
  if (typeof value !== "string") continue;
  for (const m of value.matchAll(/var\((--[\w-]+)\)/g)) {
    referencedTokens.add(m[1]);
  }
}

describe("WF tokens vs tokens.css", () => {
  it("declares at least one token in tokens.css", () => {
    expect(declaredTokens.size).toBeGreaterThan(0);
  });

  it("references at least one token from the WF map", () => {
    expect(referencedTokens.size).toBeGreaterThan(0);
  });

  it("every WF token reference resolves to a tokens.css declaration", () => {
    const missing = [];
    for (const name of referencedTokens) {
      if (!declaredTokens.has(name)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });
});
