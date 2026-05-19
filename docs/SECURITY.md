# Security Findings

Internal log of security findings for remediation. Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low.

> **Not a disclosure policy.** This file tracks internal security findings discovered by the `security-finder` and `dependency-auditor` skills. It is NOT the project's public vulnerability-disclosure policy. If you need a public policy, create a separate top-level `SECURITY.md`.

> **Process:** When an item in this file is resolved, **delete its entry from this file** and add a corresponding entry to the **Security Issues Resolved** section of [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain findings that have not yet been remediated.

> **ID prefixes used in this file:**
> - `SEC-XXX` — code-review findings from `/security-finder`
> - `DEP-XXX` — dependency-audit findings from `/dependency-auditor`

---

_No open findings as of 2026-05-13. The four findings from the 2026-05-13 backend/ scan (SEC-001 through SEC-004) and the two CSP-hardening findings from the 2026-05-13 frontend/ scan (SEC-005, SEC-006) have been remediated; see [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) "Security Issues Resolved" for details. The third frontend finding (SEC-007 · `style-src 'unsafe-inline'`) was reclassified as accepted tech debt — the inline-style → CSS-class migration is tracked in [`Technical_Debt.md`](Technical_Debt.md) instead because no active XSS sink exists for it to exploit._
