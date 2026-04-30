---
name: tech-debt-finder
description: >
  Use this skill whenever the user asks Claude Code to find, identify, scan for, or audit 
  technical debt in their project. Triggers include phrases like "find technical debt", 
  "audit the codebase", "what needs to be cleaned up", "find TODOs", "check for hardcoded values", 
  "what's outdated", "find duplicated code", "check documentation", "missing tests", 
  "what should be refactored", or any request to review code health beyond bugs and performance. 
  Also trigger when the user mentions specific files or folders and asks about their maintainability 
  or long-term code quality. Use this skill even if the user phrases it casually, e.g. 
  "anything that needs cleaning up?" or "what's been left half-done in the api folder?" — 
  these are technical debt audit requests.
---

# Tech Debt Finder

Systematically scans project code for technical debt and documents findings in a markdown file.

**This skill focuses on long-term maintainability and code health.** It does not replace bug-finder or efficiency-finder — but when a finding clearly overlaps with those skills, it flags it and asks the user how to categorize it.

---

## Step 1: Determine Scope

### If the user named specific files or folders:
- Use exactly those targets. Do not expand scope beyond what was specified.
- Confirm briefly: "I'll scan `src/auth/` and `utils/helpers.js` for technical debt."

### If the user did NOT specify a scope:
- **Do not assume.** Ask the user before scanning anything.
- Say something like:

  > "Where should I look for technical debt? I can scan:
  > - The entire project
  > - Specific folders (e.g., `src/`, `api/`)
  > - Specific files
  >
  > Let me know and I'll get started."

- Wait for confirmation before proceeding.

---

## Step 2: Read the Target Files

For each file in scope:
- Read its full content using the appropriate tool (`read_file`, `cat`, etc.)
- Note the file's language, framework patterns, and apparent purpose

---

## Step 3: Analyze for Technical Debt

Look for genuine, meaningful debt — not trivial nits. Focus on these categories:

**Outdated dependencies / deprecated APIs**
- Package versions with known newer majors that include breaking changes or security fixes
- Use of APIs, methods, or modules marked deprecated in the language/framework
- References to libraries that have been abandoned or superseded

**Missing or outdated documentation / comments**
- Public functions, classes, or modules with no docstring or comment
- Comments that clearly no longer match the code they describe
- Missing README sections for non-obvious setup steps or architectural decisions

**Hardcoded values that should be configurable**
- Magic numbers or strings embedded in logic (URLs, thresholds, limits, credentials, feature flags)
- Environment-specific values (dev URLs, ports, paths) that should be in config or `.env`

**Duplicated code that should be abstracted**
- Identical or near-identical logic repeated across multiple files or functions
- Copy-pasted blocks that diverge only in variable names
- Patterns repeated 3+ times that would benefit from a shared utility

**Overly complex logic that should be simplified**
- Functions exceeding ~50 lines with no clear internal structure
- Deeply nested conditionals (3+ levels) that could be flattened or extracted
- Logic that requires significant effort to trace due to unclear naming or structure

**Missing tests for critical paths**
- Core business logic, auth flows, or data-transforming functions with no test coverage
- Public API endpoints or exported functions with no corresponding test file
- Error handling paths that are entirely untested

**TODOs / FIXMEs left in the code**
- Any `TODO`, `FIXME`, `HACK`, `XXX`, or `TEMP` comments
- Commented-out blocks of code left in place without explanation

---

## Step 4: Handle Overlap with Bug-Finder or Efficiency-Finder

If a finding could reasonably belong to bug-finder or efficiency-finder (e.g., duplicated logic that also causes a performance issue, or a TODO that describes a known bug), **do not silently categorize it**. Instead:

1. Note it as a potential overlap in your findings.
2. After completing the full scan, ask the user:

   > "I found [N] item(s) that could also be categorized as a bug or efficiency issue rather than technical debt:
   > - `path/to/file.js` line 42 — [short description]
   >
   > Would you like me to log these under technical debt, or would you prefer I move them to the bug-finder or efficiency-finder log instead?"

3. Wait for the user's answer before writing those items to the log.

---

## Step 5: Find or Create the Tech Debt Log File

Look for an existing technical debt documentation file in the project root. Check for any of these (in priority order):
1. `Technical_Debt.md`
2. `TECH_DEBT.md`
3. `TECHNICAL_DEBT.md`
4. `tech-debt.md`
5. `DEBT.md`
6. Any `.md` file with "debt" or "technical" in the name

If one exists: **append** to it (do not overwrite).  
If none exists: create `Technical_Debt.md` in the project root with this header:

```markdown
# Technical Debt

Known technical debt catalogued for future resolution. Priority: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an item in this file is resolved, **delete its entry from this file** and add a corresponding entry to the **Technical Debt Paid Off** section of [`RESOLVED_HISTORY.md`](RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain debt that has not yet been addressed.

---
```

---

## Step 6: Document the Findings

Append a dated scan section to the log file using this format:

```markdown
## Tech Debt Scan — {DATE} ({SCOPE})

> Scanned: `path/to/file.js`, `path/to/other/`  
> Found: {N} item(s)

---

### TD-001 · {Short Title}
- **File**: `path/to/file.js`
- **Line(s)**: 42–44
- **Category**: Outdated Dependency / Missing Docs / Hardcoded Value / Duplicated Code / Overly Complex Logic / Missing Tests / TODO-FIXME
- **Priority**: High / Medium / Low
- **Description**: Clear explanation of the debt and why it matters long-term.
- **Suggested Improvement**: How to address it. If confidence is low, prefix with `⚠️ Unsure:`

---

### TD-002 · {Short Title}
...
```

**Priority guide:**
- **High** — Actively hinders development, poses a maintainability risk, or is likely to cause issues soon
- **Medium** — Will slow the team down over time if left unaddressed
- **Low** — Worth fixing eventually but low urgency

If no debt is found, still append a section:

```markdown
## Tech Debt Scan — {DATE} ({SCOPE})

> Scanned: `...`  
> ✅ No technical debt found.
```

---

## Step 7: Report to the User

After writing the file, give the user a brief summary:

- How many items were found
- A one-line summary of the highest-priority ones
- Confirm which file the findings were written to
- Example: "Found 5 tech debt items (2 High, 3 Medium) — details written to `TECH_DEBT.md`."

Do not dump the entire file into the chat. The user can open the file directly.
