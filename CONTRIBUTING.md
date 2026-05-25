# Contributing to Passage

Thanks for the interest. Passage is a single-maintainer hobby project at the
moment, but contributions are welcome — the conventions below have been
followed in commit history for a while; codifying them here so a first PR
doesn't have to reverse-engineer the style.

## Quick links

- **Local setup:** [`README.md`](README.md) → *Setup*.
- **Project orientation for code-aware tools (and humans):** [`CLAUDE.md`](CLAUDE.md).
- **Open work tracked here:**
  - Bugs — [`docs/BUGS.md`](docs/BUGS.md)
  - Technical debt — [`docs/Technical_Debt.md`](docs/Technical_Debt.md)
    (sequencing in [`docs/Technical_Debt_Roadmap.md`](docs/Technical_Debt_Roadmap.md))
  - Efficiency — [`docs/Efficiency_Improvements.md`](docs/Efficiency_Improvements.md)
  - Security — [`docs/SECURITY.md`](docs/SECURITY.md)
  - Feature plans — [`docs/FEATURE_PLANS.md`](docs/FEATURE_PLANS.md)
- **History:** [`docs/FEATURE_HISTORY.md`](docs/FEATURE_HISTORY.md),
  [`docs/archive/RESOLVED_HISTORY.md`](docs/archive/RESOLVED_HISTORY.md).
- **Data-source attributions:** [`ATTRIBUTION.md`](ATTRIBUTION.md).

## Branch model

- `main` is the only persistent branch.
- Work on a topic branch (`feature/short-description`, `fix/short-description`,
  or `claude/<slug>` for AI-assisted work). Push the branch, open a PR to
  `main`, merge, and delete the branch.
- No long-lived release / develop branches.

## Commits

Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/)
with one project-specific extension:

| Prefix      | Use for                                                          |
|-------------|------------------------------------------------------------------|
| `feat:`     | User-facing new feature or behavior change                       |
| `fix:`      | Bug fix                                                          |
| `perf:`     | Performance / memory improvement with no behavior change         |
| `refactor:` | Code restructuring with no behavior change                       |
| `docs:`     | Documentation, comments, or in-repo markdown only                |
| `test:`     | Test-only changes                                                |
| `chore:`    | Tooling, config, gitignore, dependency bumps                     |
| `data:`     | Regenerating or updating a `backend/data/*` artifact             |

Keep subjects under ~80 characters. Body explains *why*; the diff already
explains *what*.

Reference the work-item ID when applicable (`fix: harden greenest routing
against bad canopy/park data (BUG-003, BUG-004)`).

If a chunk of work is AI-assisted, the existing convention is to append a
`Co-Authored-By:` trailer (see recent commits for the exact format). Not
required for human-only changes.

## Tests are required before merge

- **Backend:** `cd backend && python -m pytest`
  (the project's `backend/.venv` is the supported interpreter; see
  [`CLAUDE.md`](CLAUDE.md) for the venv setup note).
- **Frontend:** `cd frontend && npm test && npm run lint`.
- **Build sanity:** `cd frontend && npm run build` for any change that
  touches `vite.config.js`, `package.json`, or dependency code-paths.

If a test legitimately needs to change because the contract changed, update
the test in the same PR — don't disable or skip it without an explicit
note in the PR body explaining the reason.

For UI changes, run the dev server and exercise the change in a browser
before declaring the work done. Type-checks and tests verify code, not
feature behavior.

## When landing a technical-debt chunk

The repo treats `docs/Technical_Debt.md` as the source-of-truth catalog of
unresolved debt. When a chunk lands, follow the
**[Chunk completion checklist](docs/Technical_Debt_Roadmap.md#chunk-completion-checklist)**
in the roadmap — at minimum that means:

1. Delete the resolved TD entry from `docs/Technical_Debt.md`.
2. Add a resolution entry under "Technical Debt Paid Off" in
   `docs/archive/RESOLVED_HISTORY.md`.
3. Prune the dep graph + soft-dep rows in
   `docs/Technical_Debt_Roadmap.md`.
4. Update `CLAUDE.md` / `README.md` if the change touched any documented
   surface (API shape, env vars, project tree, key design decision).

The catalog should only ever contain debt that has not yet been addressed.

## Pull-request guidelines

- **Title:** matches commit subject style (`feat: …`, `fix: …`, etc.).
- **Body:** 1–3 bullets summarizing the change + a "Test plan" checklist
  (the format the repo's `gh pr create` invocations use).
- **One topic per PR** where practical. Bundled refactors are fine when
  the bundling itself is the point (e.g. perf passes batched by chunk).
- **No force-pushes to `main`** and no `--no-verify` on commits unless
  the user explicitly asks (pre-commit hooks are there for a reason).

## Reporting bugs and security issues

- **Functional bugs:** open a GitHub issue describing reproduction steps,
  expected vs. observed behavior, and the browser / device if mobile.
- **Security issues:** email <wayfarer.atlas@gmail.com> rather than opening
  a public issue. See [`docs/SECURITY.md`](docs/SECURITY.md) for the open
  findings catalog and resolved-history conventions.

## Code of Conduct

This project follows the Contributor Covenant 2.1 — see
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Contact for conduct issues:
<wayfarer.atlas@gmail.com>.
