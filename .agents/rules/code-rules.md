---
name: code-rules
version: 1.0.0
priority: P0
trigger: model_decision
description: Apply when writing, building, refactoring, or fixing code — project-type agent routing, the Socratic Gate, Plan Mode phases, and the final checklist/scripts. Skip for pure questions or text-only responses.
---

# Code Rules (TIER 1) - AG Kit

> Loaded when the request involves writing or modifying code.

---

## 📱 Project Type Routing

| Project Type                           | Primary Agent         | Skills                        |
| -------------------------------------- | --------------------- | ----------------------------- |
| **MOBILE** (iOS, Android, RN, Flutter) | `mobile-developer`    | mobile-design                 |
| **WEB** (Next.js, React web)           | `frontend-specialist` | frontend-design               |
| **BACKEND** (API, server, DB)          | `backend-specialist`  | api-patterns, database-design |

> 🔴 **Mobile + frontend-specialist = WRONG.** Mobile = mobile-developer ONLY.

---

## 🛑 GLOBAL SOCRATIC GATE

**MANDATORY: Every user request must pass through the Socratic Gate before ANY tool use or implementation.**

| Request Type            | Strategy       | Required Action                                                   |
| ----------------------- | -------------- | ----------------------------------------------------------------- |
| **New Feature / Build** | Deep Discovery | ASK minimum 3 strategic questions                                 |
| **Code Edit / Bug Fix** | Context Check  | Confirm understanding + ask impact questions                      |
| **Vague / Simple**      | Clarification  | Ask Purpose, Users, and Scope                                     |
| **Full Orchestration**  | Gatekeeper     | **STOP** subagents until user confirms plan details               |
| **Direct "Proceed"**    | Validation     | **STOP** → Even if answers are given, ask 2 "Edge Case" questions |

**Protocol:**

1. **Never Assume:** If even 1% is unclear, ASK.
2. **Handle Spec-heavy Requests:** When user gives a list (Answers 1, 2, 3...), do NOT skip the gate. Instead, ask about **Trade-offs** or **Edge Cases** (e.g., "LocalStorage confirmed, but should we handle data clearing or versioning?") before starting.
3. **Wait:** Do NOT invoke subagents or write code until the user clears the Gate.
4. **Reference:** Full protocol in `@[skills/brainstorming]`.

---

## 🏁 Plan Mode (4-Phase)

1. ANALYSIS → Research, questions
2. PLANNING → `{task-slug}.md`, task breakdown
3. SOLUTIONING → Architecture, design (NO CODE!)
4. IMPLEMENTATION → Code + tests

---

## 🏁 Final Checklist Protocol

**Trigger:** When the user says "run the final checks", "final checks", "run all the tests", or similar phrases.

| Task Stage       | Command                                            | Purpose                        |
| ---------------- | -------------------------------------------------- | ------------------------------ |
| **Manual Audit** | `python .agents/scripts/checklist.py .`             | Priority-based project audit   |
| **Pre-Deploy**   | `python .agents/scripts/checklist.py . --url <URL>` | Full Suite + Performance + E2E |

**Priority Execution Order:**

1. **Security** → 2. **Lint** → 3. **Schema** → 4. **Tests** → 5. **UX** → 6. **Seo** → 7. **Lighthouse/E2E**

**Rules:**

- **Completion:** A task is NOT finished until `checklist.py` returns success.
- **Reporting:** If it fails, fix the **Critical** blockers first (Security/Lint).

**Available Scripts (10 total):**

| Script                     | Skill                 | When to Use         |
| -------------------------- | --------------------- | ------------------- |
| `security_scan.py`         | vulnerability-scanner | Always on deploy    |
| `lint_runner.py`           | lint-and-validate     | Every code change   |
| `test_runner.py`           | testing-patterns      | After logic change  |
| `schema_validator.py`      | database-design       | After DB change     |
| `ux_audit.py`              | frontend-design       | After UI change     |
| `accessibility_checker.py` | frontend-design       | After UI change     |
| `seo_checker.py`           | seo-fundamentals      | After page change   |
| `mobile_audit.py`          | mobile-design         | After mobile change |
| `lighthouse_audit.py`      | performance-profiling | Before deploy       |
| `playwright_runner.py`     | webapp-testing        | Before deploy       |

> 🔴 **Agents & Skills can invoke ANY script** via `python .agents/skills/<skill>/scripts/<script>.py`

---

## 🛡️ Multi-Tenant Isolation & Zero-Mock Guardrails

**MANDATORY FOR ALL CODE AND ARCHITECTURE WORK:**

1. **Zero Mock Fallbacks in Production Code**:
   - NEVER embed hardcoded business entities (mock locations, sample campaigns, fake revenue figures, dummy counters, or placeholder brand names like "Zennila" or "Phoenix Mall") in production client libraries or components.
   - If a database query returns empty or fails, return empty collections (`[]`), zero counts (`0`), or render a clean empty state. Never silently substitute fake demonstration data.

2. **Mandatory Tenant-Scoped Browser Storage**:
   - ALL `localStorage` and `sessionStorage` keys holding tenant-specific preferences, caches, or state MUST be dynamically namespaced with `_${accountEmail}` or `_${accountId}`.
   - Global un-namespaced keys (e.g. `luminila_active_pos_loc`, `luminila_alert_config`) are strictly prohibited for tenant-owned state.

3. **Database-First State (No Shared Flat Files)**:
   - Transactional, CMS, and operational data MUST reside in PocketBase collections with strict tenant rules (`account_email = @request.auth.email`).
   - NEVER write or read tenant data to/from shared flat files on the server disk (e.g. `src/data/*.json`).

4. **Full-Stack Isolation Verification**:
   - Isolation audits and tests MUST NOT rely solely on Node.js PocketBase SDK queries. They must explicitly verify client-side storage keys and fallback code paths that execute in browser environments (`window.localStorage`).

5. **No Silent Catch Degradation**:
   - Do NOT use catch-blocks (`catch { return DEFAULT_DATA }`) that mask missing database tables or failed API queries with pre-fabricated seed data. Fail explicitly or return an empty dataset.
