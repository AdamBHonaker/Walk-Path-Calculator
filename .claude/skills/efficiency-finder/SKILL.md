---
name: efficiency-finder
description: >
  Use this skill whenever the user asks Claude Code to find, identify, scan for, or audit 
  opportunities to improve code efficiency or reduce memory usage in their project. Triggers include 
  phrases like "improve efficiency", "optimize memory", "reduce file size", "find inefficiencies", 
  "make it faster", "reduce memory footprint", "optimize my code", "what's slowing things down", 
  or any request to review code for performance or memory improvements. Also trigger when the user 
  mentions specific files or folders and asks if they can be optimized or made more efficient. 
  Use this skill even if the user phrases it casually, e.g. "can this be leaner?" or 
  "anything wasteful in the utils folder?" — these are efficiency audit requests.
---

# Efficiency Finder

Systematically scans project code for efficiency and memory improvement opportunities, and documents findings in a markdown file.

**Do NOT report bugs, correctness issues, or style preferences** — those belong in the bug-finder skill. This skill focuses exclusively on efficiency and memory.

---

## Step 1: Determine Scope

### If the user named specific files or folders:
- Use exactly those targets. Do not expand scope beyond what was specified.
- Confirm briefly: "I'll scan `src/auth/` and `utils/helpers.js` for efficiency and memory improvements."

### If the user did NOT specify a scope:
- **Do not assume.** Ask the user before scanning anything.
- Say something like:

  > "Where should I look for efficiency and memory improvements? I can scan:
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

## Step 3: Analyze for Efficiency & Memory Issues

Look for genuine, meaningful opportunities — not micro-optimizations or stylistic rewrites. Focus on:

**Redundant computation**
- Values recalculated on every loop iteration that could be computed once
- Repeated function calls with identical arguments inside loops
- Derived data recomputed instead of cached or memoized

**Inefficient data structures**
- Using arrays for frequent lookups (should be Maps or Sets)
- Repeatedly scanning large arrays when an index or hash would be faster
- Deeply nested structures that require full traversal for common operations

**Memory leaks & bloat**
- Event listeners added but never removed
- Timers or intervals that are never cleared
- Large objects or arrays held in memory beyond their useful life
- Closures unintentionally retaining large outer-scope variables
- Growing data structures (arrays, maps) that are never pruned or bounded

**Unnecessary file or asset size**
- Importing entire libraries when only one function is used (e.g., `import _ from 'lodash'` vs `import debounce from 'lodash/debounce'`)
- Large constants, lookup tables, or static data embedded in code that could be externalized or lazy-loaded
- Duplicate data defined in multiple places

**Inefficient I/O or async patterns**
- Sequential `await` calls that could run in parallel with `Promise.all`
- Fetching more data than needed (over-fetching from APIs or databases)
- Missing pagination or streaming for large datasets
- Repeated reads of the same file or resource without caching

**Rendering / DOM inefficiency (frontend code)**
- Components re-rendering unnecessarily due to missing memoization
- Large lists rendered without virtualization
- Expensive calculations performed inline during render

**Do NOT report:**
- Bugs or correctness issues (use bug-finder for those)
- Code style preferences or formatting
- Refactors that improve readability but not efficiency or memory
- Micro-optimizations with negligible real-world impact

---

## Step 4: Find or Create the Efficiency Log File

Look for an existing efficiency documentation file in the project root. Check for any of these (in priority order):
1. `Efficiency_Improvements.md`
2. `EFFICIENCY_IMPROVEMENTS.md`
3. `OPTIMIZATIONS.md`
4. `PERFORMANCE.md`
5. Any `.md` file with "efficiency", "optimize", or "performance" in the name

If one exists: **append** to it (do not overwrite).  
If none exists: create `Efficiency_Improvements.md` in the project root with this header:

```markdown
# Efficiency Improvements

Known efficiency improvements catalogued for future implementation. Impact: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an efficiency improvement in this file is implemented, **delete its entry from this file** and add a corresponding entry to the **Efficiency Improvements Implemented** section of [`RESOLVED_HISTORY.md`](RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain improvements that have not yet been implemented.

---
```

---

## Step 5: Document the Findings

Append a dated scan section to the log file using this format:

```markdown
## Efficiency Scan — {DATE} ({SCOPE})

> Scanned: `path/to/file.js`, `path/to/other/`  
> Found: {N} opportunity/opportunities

---

### OPT-001 · {Short Title}
- **File**: `path/to/file.js`
- **Line(s)**: 42–44
- **Category**: Redundant Computation / Memory Leak / Inefficient Data Structure / Unnecessary Import / Async Pattern / Rendering / Other
- **Impact**: High / Medium / Low
- **Description**: Clear explanation of the inefficiency and its likely effect on performance or memory.
- **Suggested Improvement**: How to address it. If confidence is low, prefix with `⚠️ Unsure:`

---

### OPT-002 · {Short Title}
...
```

**Impact guide:**
- **High** — Likely to cause noticeable slowness, memory growth, or large unnecessary file size
- **Medium** — Meaningful improvement in non-trivial usage or at scale
- **Low** — Minor gain; worth doing but not urgent

If no opportunities are found, still append a section:

```markdown
## Efficiency Scan — {DATE} ({SCOPE})

> Scanned: `...`  
> ✅ No efficiency or memory issues found.
```

---

## Step 6: Report to the User

After writing the file, give the user a brief summary:

- How many opportunities were found
- A one-line summary of the highest-impact ones
- Confirm which file the findings were written to
- Example: "Found 4 opportunities (2 High, 2 Low) — details written to `EFFICIENCY_IMPROVEMENTS.md`."

Do not dump the entire file into the chat. The user can open the file directly.
