# Security Audit Report — Luminila Inventory Management

- **Date:** 2026-10-17
- **Project:** `E:\Local_GIT_2\luminila_inv_mgmt` (branch `feature/vyapar-sprint-phase1`, HEAD `2e22ca9`)
- **Auditor:** Automated deep static scan (Mimosa, 2 sealed runs) + manual code review
- **Evidence boundary:** static analysis and code reading only — no runtime execution, no dynamic testing, no code modification. `verdictEffect: none` on all automated verdicts.

---

## 1. Executive summary

Two sealed deep scans and a manual review of the WhatsApp sidecar, the Tauri desktop shell, and the client library were performed. The automated pass produced 62 findings (30 HIGH, 32 MEDIUM). After manual adjudication:

- **3 findings are confirmed HIGH-risk** — all concentrate in the WhatsApp sidecar (`wppconnect-sidecar/server.js`): the sidecar API has **no authentication**, its **origin trust is over-broad and Host-header-blind** (drive-by / DNS-rebinding exposure), and one **hardcoded admin password** sits in a scratch script (on disk, not in git).
- **4 findings are confirmed MEDIUM** — permissive Tauri CSP, shell-command construction in dev tooling, Chromium running without sandbox, and 18 dependency packages carrying 38 known advisories.
- **34 automated findings are false positives or mitigated by design** (12 path-traversal, ~24 SSRF, 4 generated-file command injections) — dismissals are justified in §5.
- The main Next.js application (`src/`) produced **no confirmed direct code findings**.

Highest-priority actions (§6): enforce a bearer token on the sidecar, validate the `Host` header and pin trusted origins, rotate the PocketBase admin password.

---

## 2. Scope and methodology

### 2.1 Automated scans (sealed)

| | Scan 1 | Scan 2 (full-coverage re-run) |
|---|---|---|
| Scan ID | `scan-2026-10-17T13-20-58.934Z-ec8c4fbb7d2c` | `scan-2026-10-17T13-32-03.801Z-e5988ec289c4` |
| Seal | `sha256:d5af35d4cb3f2864c442dc73225fbfdee60e529e0e9e44410adc5d2ea6991e93` | `sha256:383abb52ce5a3ffc4088b0ca68a0673c6b54c1810c89342a341537ae0cf62f26` |
| Artifacts | `C:\Users\sivan\.mimosa\security-scans\project-c5983c95557e66ecfeb2eb9f\scan-2026-10-17T13-20-58.934Z-ec8c4fbb7d2c` | `…\scan-2026-10-17T13-32-03.801Z-e5988ec289c4` |
| Result | 62 findings, 18 business-logic candidates | identical (deterministic engine) |

Both runs: depth `deep`, 293/293 files parsed, 0 read/parse failures, 4,870 functions / 5,533 call edges analyzed, 97 entry points, 173 authorization surfaces. Scan 2 explicitly enumerated all 282 real source files as focus files — output was byte-equivalent, confirming scan 1 already covered the full real-source surface.

### 2.2 Manual review scope

- `wppconnect-sidecar/server.js` (complete, 2,498 lines) — authentication, origin/CORS handling, session-name handling, filesystem paths, route inventory.
- `src-tauri/` — `src/main.rs`, `src/lib.rs`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`.
- `src/lib/whatsapp.ts` — sidecar client authentication posture.
- Repo file inventory — real source vs. build artifacts (§3).

---

## 3. Coverage statement

The working tree contains ~880 JS/TS files; **282 are real source** (`src/` 204, `pocketbase/pb_migrations` + `types.d.ts` 26, `scratch/` 24, `storefront/src` + configs 17, `scripts/` 6, `wppconnect-sidecar` 2, root configs 3). The remainder are build output — `src-tauri/target` (273), `out/_next` (75), `storefront/.next` + `storefront/out` (227) — plus `.zcode`/`.agents` tooling configs. These were correctly excluded by the engine; scanning them would only add noise.

**Overall run status: `inconclusive` / `completeness: partial`** — not because files were skipped, but because of two phase-level limits that no parameter lifts:

1. **Validation budget** — 202 queries across 18 hypotheses; one finding records "query budget exhausted: could not obtain entry guard". The 15 then-inconclusive authorization hypotheses were subsequently resolved by manual review (root cause: SEC-01).
2. **Dynamic dispatch** — statically unresolvable calls leave cross-file reachability incomplete. Inherent to JS static analysis; the tool refuses to over-claim.

Out of engine scope (JS/TS-only engine): the 3 small Rust files of the Tauri shell — reviewed manually instead (§4.8).

---

## 4. Confirmed findings

### SEC-01 · HIGH — Sidecar API has no authentication

- **Location:** `wppconnect-sidecar/server.js:18` (dead `SECRET_KEY`), `:2493` (bind `127.0.0.1:21465`), all ~70 routes.
- **Description:** `SECRET_KEY` is defined once with a hardcoded fallback (`'luminila-secret-key'`) and **never referenced again**. No middleware, no token check. The app client (`src/lib/whatsapp.ts`) sends no `Authorization` header either. The only access controls are the loopback bind and the origin allowlist (SEC-02).
- **Impact:** any process running under any local user account can, unauthenticated: read all chat history (`/api/:session/messages/:chatId`, line 782), pull the entire contact list (line 1014), capture WhatsApp Web screenshots (line 2087), send messages as the store's business account (line 667), download all media (line 817), or destroy the session (`/reset`, line 569). Loopback has no per-user ACL on Windows — "any local process" includes any malware on the point-of-sale machine.
- **Recommendation:** generate a random secret at sidecar startup, require `Authorization: Bearer <token>` on every route (including `/api/status` and Socket.IO handshake), pass it to the app out-of-band, and refuse to start on the hardcoded default.

### SEC-02 · HIGH — Over-broad origin trust and no Host validation (drive-by / DNS rebinding)

- **Location:** `wppconnect-sidecar/server.js:74-94`.
- **Description:** three distinct weaknesses in the CORS/origin gate:
  1. `TRUSTED_ORIGIN` (line 76) matches **any** `*.trycloudflare.com` subdomain. Quick tunnels on that domain are free and instant — an attacker's own tunnel matches the pattern. The response also opts in to Chrome private-network access (`Access-Control-Allow-Private-Network: true`, line 92), so a malicious tunnel page visited by the user can drive the sidecar from the browser.
  2. It trusts **every** host on `10.x`, `192.168.x`, `172.16–31.x` on any port — on shared shop Wi-Fi, any device can serve such an origin.
  3. The `Host` header is never validated and requests **without** an `Origin` are always allowed (line 79). GET navigations send no `Origin`, so **DNS rebinding** reads every data endpoint (`/chats`, `/messages/:chatId`, `/contacts`, `/all-unread-messages`, `/take-screenshot`) from an attacker page.
- **Impact:** a website the shop owner visits can silently read the store's WhatsApp conversations or send messages as the store — without any local malware.
- **Recommendation:** validate `Host` ∈ {`127.0.0.1:PORT`, `localhost:PORT`}; pin the exact tunnel hostname(s) in use rather than the whole `trycloudflare.com` domain; replace the LAN wildcard with explicit entries via the existing `WPP_ALLOWED_ORIGINS` env var.

### SEC-03 · MEDIUM — Hardcoded PocketBase admin password on disk

- **Location:** `scratch/sync_admin.js:13`.
- **Description:** plaintext admin credential in a one-off script. Verified **untracked** in git (never committed, no history purge needed) but present in the working tree alongside the live `pocketbase/pb_data/` database.
- **Impact:** anyone/anything with read access to the machine's files gets PocketBase admin. The script also documents how the credential is used.
- **Recommendation:** rotate this password now (treat it as burned), move future one-offs to env-var auth, and keep `scratch/` out of any future commit or bundle (it also contains reverse-engineered third-party code, §4.9).

### SEC-04 · MEDIUM — Permissive Tauri CSP

- **Location:** `src-tauri/tauri.conf.json:26`.
- **Description:** `script-src 'self' 'unsafe-inline'` allows injected inline scripts to execute, and `connect-src http: https: ws: wss:` permits exfiltration to any host. The webview renders WhatsApp message content, so the injection surface is real.
- **Recommendation:** drop `unsafe-inline` from `script-src` (use nonces/hashes), enumerate the actual connect/img origins (PocketBase, localhost sidecar, media CDN).

### SEC-05 · MEDIUM — Shell-command construction in dev tooling

- **Location:** `scripts/dev-all.js:75`, `scripts/tunnel.js:109`, `wppconnect-sidecar/build.js:55`.
- **Description:** external values (env vars / arguments) are concatenated into shell commands (static taint finding; not manually exploit-verified). Affects developer workflows, not the shipped app.
- **Recommendation:** switch to `execFile`/array-argument spawns or validate inputs; low urgency but cheap to fix.

### SEC-06 · MEDIUM (accepted risk) — Chromium automation without sandbox

- **Location:** `wppconnect-sidecar/server.js:157-164` (`--no-sandbox`, `--disable-setuid-sandbox`).
- **Description:** the WhatsApp Web automation browser runs with the Chromium sandbox disabled (common for wppconnect/puppeteer setups). Removes the last containment layer of a browser navigating web content.
- **Recommendation:** document as accepted risk, or evaluate sandboxed mode per platform.

### SEC-07 · MEDIUM — Dependency advisories

- **Summary:** 1,410 packages scanned (completed); offline advisory DB matched **18 packages carrying 38 known advisories** (0 unknown). The sealed summary does not enumerate package names.
- **Recommendation:** run `npm audit` in each package root (`./`, `storefront/`, `wppconnect-sidecar/`) to enumerate and upgrade; re-scan afterwards.

### SEC-08 · LOW — Unauthenticated Tauri command callable from webview

- **Location:** `src-tauri/src/lib.rs:130-147` (`restart_sidecar`).
- **Impact:** worst case repeated sidecar restart (local DoS) if script injection into the webview occurs (see SEC-04). Capabilities are otherwise minimal (`core:default` only).

### SEC-09 · INFO — Hygiene observations

- Duplicate route definitions (dead code): `/api/:session/close` at `server.js:657` **and** `:2121`; `/api/:session/logout` at `:542` **and** `:2141`. Express serves the first of each.
- JSON body limit `50mb` (`server.js:112`) — generous memory exposure for a local API.
- Socket.IO broadcasts every incoming WhatsApp message to any connected client (`server.js:223`).
- Live PocketBase database (`pocketbase/pb_data/data.db`, WAL/SHM) sits in the working tree — gitignored and untracked (only `.gitkeep` committed), but include it in disk-backup threat modeling.
- `scratch/extracted_js/**` contains reverse-engineered third-party (Vyapar) code — redistribution risk if ever committed or shipped.

### SEC-10 · INFO — Rust/Tauri shell review result

`src-tauri/src/main.rs`, `src/lib.rs`, `build.rs`: no `unsafe`, no secrets, no filesystem access; sole network call is the localhost health check (`lib.rs:16`). Exposed commands are `get_sidecar_status` and `restart_sidecar` (SEC-08). No actionable findings.

---

## 5. Dismissed automated findings (with justification)

| Automated finding | Count | Dismissal reason |
|---|---|---|
| Path traversal via `getSessionTokenPath` / `cleanSessionTokens` / `bootSession` | 12 HIGH | `server.js:104-110` enforces `SESSION_NAME = /^[A-Za-z0-9_-]{1,64}$/` on every `:session` route param before any handler. The charset excludes `/`, `\`, and `.`, so `..` traversal is impossible; derived names (`${session}_phone`) inherit the guarantee. |
| SSRF via `checkNumberStatus`, `archiveChat`, `deleteLabel`, `editBusinessProfile`, etc. | ~10 HIGH + 14 MEDIUM | The flagged "sinks" are wppconnect client methods driving the already-authenticated WhatsApp Web page (puppeteer `page.evaluate`); the resulting requests go to WhatsApp's own servers, not attacker-chosen URLs. Residual URL-fetch capability (`send-image` `imageUrl`) is subsumed by SEC-01 — an attacker who can call it already owns the client. |
| Command injection in `pocketbase/pb_data/types.d.ts` | 4 HIGH | Generated type-declaration file, non-executable, gitignored. |
| "Sensitive operation without role/permission check" (18 business-logic hypotheses) | 18 MEDIUM | Root cause confirmed by manual review and consolidated into **SEC-01** — there is no authentication layer at all; per-route RBAC is meaningless until a token exists. |

---

## 6. Remediation roadmap

| Priority | Item | Effort |
|---|---|---|
| **P0** | SEC-01: bearer-token auth on sidecar (all routes + Socket.IO handshake) | S |
| **P0** | SEC-02: `Host` header validation; pin exact tunnel origin; explicit LAN origins | S |
| **P0** | SEC-03: rotate the PocketBase admin password exposed in `scratch/sync_admin.js` | S |
| **P1** | SEC-04: Tauri CSP hardening (no `unsafe-inline` scripts; enumerated connect-src) | M |
| **P1** | SEC-07: `npm audit` triage and upgrades across all three package roots | M |
| **P2** | SEC-05: array-argument spawn in dev scripts | S |
| **P2** | SEC-06: sandbox decision/documentation; SEC-08/09 hygiene (dedupe routes, body limit, dead code) | S |

---

## 7. Limitations

- **Static-only.** No runtime verification of any hypothesis; exploitability of SEC-01/SEC-02 browser vectors depends on the victim's browser (PNA enforcement state, DNS rebinding protections).
- The scan's call graph is incomplete for dynamic dispatch (§3) — absence of further findings is not proof of absence.
- Dependency advisory names were not enumerated by the sealed summary; SEC-07 requires `npm audit` follow-up.
- Rust sources were outside the automated engine's language scope and reviewed manually only.

## 8. Audit trail

All sealed artifacts (findings.json, coverage.json, scan-manifest.json, seal.json, report.md) reside under `C:\Users\sivan\.mimosa\security-scans\project-c5983c95557e66ecfeb2eb9f\`. Seals are SHA-256 digests of the semantic JSON documents; the Markdown report is a projection and not part of the seal. Neither scan executed project code or modified the repository.

*No project files were modified during this audit; this report is the sole addition (explicitly requested).*
