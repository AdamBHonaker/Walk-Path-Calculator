---
name: bug-finder
description: >
  Use this skill whenever the user asks Claude Code to find, search for, scan for, identify, detect, 
  or audit bugs, errors, issues, or problems in their project code. Triggers include phrases like 
  "find bugs", "check for bugs", "scan for errors", "audit the code", "look for issues", 
  "what's broken", "debug my project", or any request to review code health or correctness. 
  Also trigger when the user mentions specific files or folders and asks if anything is wrong with them. 
  Use this skill even if the user phrases it casually, e.g. "can you look over my code?" or 
  "anything broken in the auth folder?" — these are bug-finding requests.
---

# Bug Finder

Systematically scans project code for bugs and documents findings in a markdown file.

---

## Step 1: Determine Scope

### If the user named specific files or folders:
- Use exactly those targets. Do not expand scope beyond what was specified.
- Confirm briefly: "I'll scan `src/auth/` and `utils/helpers.js` for bugs."

### If the user did NOT specify a scope:
- **Do not assume.** Ask the user before scanning anything.
- Say something like:

  > "Where should I look for bugs? I can scan:
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

## Step 3: Analyze for Bugs

Look for real bugs — not style issues or opinions. Focus on:

**Logic errors**
- Off-by-one errors, incorrect conditionals, wrong comparison operators
- Unreachable code or dead branches
- Incorrect loop termination

**Runtime errors / crashes**
- Null/undefined dereferences without guards
- Uncaught exceptions or unhandled promise rejections
- Type mismatches that will throw at runtime
- Index out of bounds access

**Data / state bugs**
- Variables used before initialization
- Mutations of shared/global state unexpectedly
- Race conditions or async ordering issues

**Security bugs (flag but don't over-expand scope)**
- Injection vulnerabilities (SQL, XSS, etc.)
- Hardcoded secrets or credentials
- Missing input validation

**Integration bugs**
- Wrong API call signatures
- Incorrect imports or missing dependencies
- Mismatched data shapes between modules

**Do NOT report:**
- Code style preferences
- Performance optimizations (unless they cause correctness issues)
- Refactoring suggestions unrelated to bugs

---

## Step 4: Find or Create the Bug Log File

Look for an existing bug documentation file in the project root. Check for any of these (in priority order):
1. `BUGS_TO_BE_FIXED.md`
2. `BUGS.md`
3. `bugs.md`
4. `TODO_BUGS.md`
5. Any `.md` file with "bug" or "fix" in the name

If one exists: **append** to it (do not overwrite).  
If none exists: create `BUGS_TO_BE_FIXED.md` in the project root with this header:

```markdown
# Bugs To Be Fixed

Known bugs catalogued for future fixing. Severity: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When a bug in this file is fixed, **delete its entry from this file** and add a corresponding entry to the **Bugs Fixed** section of [`RESOLVED_HISTORY.md`](RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain bugs that have not yet been resolved.

---
```

---

## Step 5: Document the Findings

Append a dated scan section to the bug log file using this format:

```markdown
## Bug Scan — {DATE} ({SCOPE})

> Scanned: `path/to/file.js`, `path/to/other/`  
> Found: {N} bug(s)

---

### BUG-001 · {Short Title}
- **File**: `path/to/file.js`
- **Line(s)**: 42–44
- **Severity**: Critical / High / Medium / Low
- **Description**: Clear explanation of what the bug is and why it's a problem.
- **Reproduction**: What triggers the bug (if not obvious).
- **Suggested Fix**: Brief note on how to resolve it. If confidence is low, prefix with `⚠️ Unsure:`

---

### BUG-002 · {Short Title}
...
```

**Severity guide:**
- **Critical** — Will crash or cause data loss in normal use
- **High** — Causes incorrect behavior in common scenarios
- **Medium** — Edge case failures or degraded behavior
- **Low** — Minor issues unlikely to surface in typical use

If no bugs are found, still append a section:

```markdown
## Bug Scan — {DATE} ({SCOPE})

> Scanned: `...`  
> ✅ No bugs found.
```

---

## Step 6: Report to the User

After writing the file, give the user a brief summary:

- How many bugs were found
- A one-line summary of the most severe ones
- Confirm which file the findings were written to
- Example: "Found 3 bugs (1 Critical, 2 Medium) — details written to `BUGS_TO_BE_FIXED.md`."

Do not dump the entire file into the chat. The user can open the file directly.
