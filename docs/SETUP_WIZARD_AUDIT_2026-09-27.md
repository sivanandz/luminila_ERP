# First-Run Wizard & First Admin Account Creation — Audit Report

**Date:** 2026-09-27
**Auditor:** Pixel Canary (Senior Fullstack Architect & QA Engineer)
**Scope:** Cold-start path on a machine with **no existing PocketBase infrastructure**
**Repository:** `luminila_inv_mgmt` @ `1b6d530`

**Audited Surfaces:**

| Layer | Artifact |
|---|---|
| Setup Wizard UI | `src/app/setup/page.tsx` |
| Auth state | `src/contexts/AuthContext.tsx` |
| RBAC resolution | `src/lib/rbac.ts`, `src/hooks/usePermissions.ts` |
| Route guarding | `src/components/auth/ProtectedRoute.tsx`, `src/app/page.tsx` |
| PB client / URL resolution | `src/lib/pocketbase.ts`, `scripts/dev-all.js` |
| Provisioning scripts | `src/scripts/init-pocketbase.ts`, `seed-roles.ts`, `create-admin-user.ts`, `apply-pb-access-rules.ts`, `unlock-users-collection.ts`, `upgrade-users-schema.ts`, `fix-superuser-collections.ts`, `enable-all-users.ts` |
| Schema / access rules | `pocketbase/pb_migrations/` (402 JSVM migrations) |
| Login & docs | `src/app/login/page.tsx`, `docs/POCKETBASE_SETUP.md`, `README.md` |

---

## Verdict: **FAIL — the documented cold-start path does not produce a usable admin account**

A first-time user following the wizard from an empty install reaches **"Setup Complete!"**, then is **permanently locked out of their own account on the next login**. Two independent defects (`WIZ-01`, `WIZ-02`) each block a working admin, and the wizard reports **success for both failure modes**.

### Severity Summary

| Severity | Count | IDs |
|---|---|---|
| 🔴 Critical | 2 | `WIZ-01`, `WIZ-02` |
| 🟠 High | 5 | `WIZ-03` … `WIZ-07` |
| 🟡 Medium | 3 | `WIZ-08` … `WIZ-10` |
| 🟢 Low | 3 | `WIZ-11` … `WIZ-13` |

---

## Environment Facts (verified, not assumed)

| Check | Result |
|---|---|
| `pocketbase\pocketbase.exe --version` | **v0.25.0** — matches `docs/POCKETBASE_SETUP.md` |
| JS SDK (`package.json`) | `pocketbase ^0.26.5` |
| TCP `:8090` on this workstation | **Occupied by `WsToastNotification` (PID 13752)**, answers **HTTP 501** |
| `pocketbase/pb_migrations` | **402** auto-generated JSVM migration files |
| Automated tests in repo | **None** — no `*.test.*` / `*.spec.*`, no test runner configured |
| `users.is_active` introduced by | `1767903293_updated_users.js` |

> **Note on the port:** the `:8090` collision is *live on this machine*, not theoretical. It is the reason `scripts/dev-all.js` silently falls back to `:8091`, and it directly causes `WIZ-07`.

---

## Detailed Findings

### 🔴 WIZ-01 — Critical: First admin is created **inactive** and is locked out at next login

**Component:** `src/app/setup/page.tsx` (`handleCreateAdmin`) → `src/contexts/AuthContext.tsx`

**Root cause.** `is_active` is a plain `bool` field on `users` (added by `1767903293_updated_users.js`). PocketBase defaults an omitted `bool` to `false` at create time. The wizard creates the admin **without** `is_active`:

```ts
// src/app/setup/page.tsx:163-170
const user = await pb.collection("users").create({
    email: appAdmin.email,
    password: appAdmin.password,
    passwordConfirm: appAdmin.passwordConfirm,
    name: appAdmin.name,
    emailVisibility: true,
    verified: true,
    // ← is_active omitted  →  PocketBase persists false
});
```

`AuthContext` then hard-rejects exactly that value:

```ts
// src/contexts/AuthContext.tsx:77-80
if (authData.record.is_active === false) {
  pb.authStore.clear();
  throw new Error("Account is inactive");
}
```

**Why the wizard hides it.** The wizard mints a token immediately after create (`setup/page.tsx:186`), so the session is already valid and the user sees `toast.success("Admin account created!")` → **"Setup Complete!"**. The rejection only fires on the *next* credential login. The user therefore experiences: *"my brand-new admin password does not work."*

**Corroborating evidence that this is a known, half-fixed bug:**
- `AuthContext.register()` correctly sends `is_active: true` (`AuthContext.tsx:100`) — only the wizard path was missed.
- `src/scripts/enable-all-users.ts` exists solely to mass-repair this field.
- `create-admin-user.ts:33-40` (the documented CLI alternative) has the **same omission**.

**User-visible outcome:** hard lockout of the sole admin account, with a message ("Account is inactive") that points at nothing the user did.

---

### 🔴 WIZ-02 — Critical: `roles` / `user_roles` access rules are **permanently unsatisfiable** (16-char ID vs. 15-char cap)

**Component:** `pocketbase/pb_migrations/1768109637_updated_roles.js` and `1768109637_updated_user_roles.js`

Both collections were pinned to:

```js
@request.auth.id != "" && @collection.user_roles.user ?= @request.auth.id
                     && @collection.user_roles.role ?= "69993t907uvfn355"
```

(applied to `createRule`, `deleteRule`, `listRule`, `updateRule`, `viewRule`).

**The defect.** `roles.id` is declared in `1767867201_created_roles.js` as:

```js
"autogeneratePattern": "[a-z0-9]{15}",   // max length 15
"pattern": "^[a-z0-9]+$",
```

`"69993t907uvfn355"` is **16 characters** (verified). **No role row on a fresh install can ever hold that ID**, so the rule can never match for anyone.

**Why it fails silently instead of erroring.** `getCurrentUserPermissions()` (`src/lib/rbac.ts:267`) issues a `user_roles` list query; the rule yields an **empty list, not an exception**. Therefore:
- `isAdmin()` returns `false` (`rbac.ts:251`)
- `usePermissions`' `catch` block never runs, so no error is surfaced
- `<ProtectedRoute resource="reports" action="read">` (`src/app/page.tsx:88`) renders **"Access Denied"**

**Impact:** on any deployment built from migrations, **every non-superuser sees "Access Denied" on every page** — including the admin the wizard just created. This is the classic *"genuinely empty vs. partially initialized"* trap: the current local `pb_data` may happen to contain a row with that ID, which masks the defect locally while making every fresh deployment unusable.

---


### 🟠 WIZ-03 — High: The wizard's own happy path ends in "Access Denied"

**Component:** `src/app/setup/page.tsx` → `src/app/page.tsx`

Chaining `WIZ-01` + `WIZ-02`: the wizard auto-logs the new admin in, the user clicks **"Go to Dashboard"**, and lands on **"Access Denied"**. The wizard offers no recovery branch — its only exit is `router.push("/")` — and prints no diagnostic explaining *why*. A first-run user has no way to distinguish "I did something wrong" from "RBAC returned zero rows".

---

### 🟠 WIZ-04 — High: Wizard's default superuser credentials contradict every script and the docs

**Component:** `src/app/setup/page.tsx:36-39` vs. provisioning scripts + `docs/POCKETBASE_SETUP.md`

| Source | Superuser password |
|---|---|
| **Wizard default** (`setup/page.tsx:36-39`) | **`Admin@123456`** |
| `init-pocketbase.ts:11` | `password123456` |
| `seed-roles.ts:106` | `password123456` |
| `create-admin-user.ts:18` | `password123456` |
| `apply-pb-access-rules.ts:34` | `password123456` |
| `unlock-users-collection.ts:8` | `password123456` |
| `upgrade-users-schema.ts:8` | `password123456` |
| `docs/POCKETBASE_SETUP.md` §4.1 | `password123456` |

A user who correctly follows the documented CLI path and then opens the wizard finds it **pre-filled with the wrong password**. `pb.admins.authWithPassword` throws at `setup/page.tsx:92`, the `catch` at `:94` fires, and the user is bounced to a fresh `_/` browser tab in a loop with no mention of a credential mismatch.

**Note:** these hardcoded defaults are also a credential-hygiene problem independent of the mismatch (see `WIZ-13`).

---

### 🟠 WIZ-05 — High: PocketBase URL is hardcoded to `127.0.0.1:8090` in the wizard, contradicting the app's own URL resolver

**Component:** `src/app/setup/page.tsx:98`, `:315`, `:356`

`src/lib/pocketbase.ts:10-29` deliberately resolves the PB base URL through several legitimate branches:

- `PB_URL` / `NEXT_PUBLIC_POCKETBASE_URL` / `PB_CUSTOM_URL` overrides (`pocketbase.ts:4`)
- **Android emulator** → `http://10.0.2.2:8090` (`pocketbase.ts:22`)
- **LAN exposure** → the host's real IP when served from a non-localhost origin (`pocketbase.ts:24`)
- Cloudflare tunnel hosts

The wizard ignores all of it and hardcodes `127.0.0.1:8090` in three places — the "open admin UI" `window.open` (`:98`), the status readout (`:315`), and the in-page admin-UI link (`:356`). On LAN, emulator, tunnel, or `:8091`-fallback setups the wizard **displays the wrong server and links to an admin UI that does not exist there** — precisely the showroom-tablet and Android scenarios the documentation promises.

---

### 🟠 WIZ-06 — High: Broken error swallowing produces **false success** reporting

**Component:** `src/app/setup/page.tsx:124-135`

```ts
try { await pb.collection("roles").create({ ... }) } catch (err) { }   // :127 — fully swallowed
toast.success("Default roles created");                                // :129 — always fires
...
toast.success("Database setup complete!");                             // :135 — always fires
```

Role seeding failures are invisible, and "Database setup complete!" is announced **even on the branch where `:109-111` just told the user to go run a CLI command**. The wizard never creates any schema — it only *verifies* collections exist and seeds roles — so the label itself overstates what happened. A user who was told to run `init-pocketbase.ts` and did not can end the wizard believing the database was provisioned.

---

### 🟠 WIZ-07 — High: Provisioning scripts ignore the actual PocketBase port

**Component:** `src/scripts/*.ts` vs. `scripts/dev-all.js:107-111`

`dev-all.js` detects that `:8090` is taken and **falls back to `:8091`**, but every provisioning script pins `:8090`:

```
src/scripts/init-pocketbase.ts:3            new PocketBase('http://127.0.0.1:8090')
src/scripts/seed-roles.ts:7                 new PocketBase('http://127.0.0.1:8090')
src/scripts/create-admin-user.ts:7          new PocketBase('http://127.0.0.1:8090')
src/scripts/apply-pb-access-rules.ts:3      new PocketBase('http://127.0.0.1:8090')
src/scripts/unlock-users-collection.ts:3    (same)
src/scripts/upgrade-users-schema.ts:3       (same)
src/scripts/fix-superuser-collections.ts:10 OK  process.env.NEXT_PUBLIC_POCKETBASE_URL || ...
```

On this machine — where `:8090` is held by an unrelated Windows process answering **HTTP 501** — the documented first-run commands fail with a confusing transport error instead of connecting to the PocketBase the project actually started. `fix-superuser-collections.ts:10` proves the correct pattern already exists in this repo; it just was not propagated.

---


### 🟡 WIZ-08 — Medium: Admin creation is not idempotent (duplicate-submission trap)

**Component:** `src/app/setup/page.tsx:143-195`

`handleCreateAdmin` performs no existence check. If `users.create` succeeds but the immediately following `authWithPassword` (`:186`) throws, the user stays on the admin step; a second click now fails with a duplicate-email 400 and there is **no path forward** except the Admin UI. `create-admin-user.ts:22-29` already implements exactly this guard — the wizard should reuse it.

---

### 🟡 WIZ-09 — Medium: The `is_active` backfill script can never repair anything

**Component:** `src/scripts/upgrade-users-schema.ts:64`

```ts
if (user.is_active === undefined || user.is_active === null) {
  await pb.collection('users').update(user.id, { is_active: true });   // :66 — unreachable
}
```

Once persisted, a PocketBase `bool` field is always `true` or `false` — never `undefined`/`null`. **The condition is never true**, so the backfill silently no-ops. This is very likely *why* the `WIZ-01` class of bug persisted: the repair tool that was supposed to catch it is a no-op. The test must be `=== false`.

---

### 🟡 WIZ-10 — Medium: No re-detection after the PocketBase URL changes

**Component:** `src/app/setup/page.tsx` (connection step)

The wizard checks connectivity once. Because `dev-all.js` may pick `:8091`, and because `pocketbase.ts` can resolve a LAN/tunnel/emulator host later, a wizard that reported "not connected" can stay stale even after the server becomes reachable. There is no `pb:server-changed` listener and no retry affordance beyond restarting the wizard.

---

### 🟢 WIZ-11 — Low: `verified: true` at create time is a known SDK/server compatibility risk

**Component:** `src/app/setup/page.tsx:169`, `src/scripts/create-admin-user.ts:39`

PocketBase issue [#6051](https://github.com/pocketbase/pocketbase/issues/6051) documents `verified: true` in a create payload producing `validation_values_mismatch` → **HTTP 400** on some 0.23.x builds. This repo runs **server 0.25.0 + SDK 0.26.5**; I could not confirm from the changelog whether the fix landed, and **no runtime validation was performed**. If it does fire here, it blocks admin creation outright — and via `WIZ-08` the user is then stranded. Flagged as *unverified risk*, not a confirmed defect.

---

### 🟢 WIZ-12 — Low: Zero test coverage on the cold-start path

No test runner or test file exists anywhere in the repo. Every defect above is reachable by unit test, and `WIZ-02` in particular is trivially detectable with one assertion (`roles.id` rule constant length/charset).

---

### 🟢 WIZ-13 — Low: Weak, hardcoded default credentials shipped in source

`Admin@123456` (`setup/page.tsx:38`) and `password123456` (7 scripts + docs) are committed to a public remote. At minimum these must move to env vars and the wizard should refuse to proceed while a default is in place.

---

## Cold-Start Flow: Where It Actually Breaks

```
npm run dev  (dev-all.js)
   +- :8090 busy -> falls back to :8091        <- WIZ-07: scripts still dial :8090
/runs  pocketbase superuser upsert             <- uses password123456
/open  /setup
   +- Step 1 Connect     authWithPassword("Admin@123456") FAILS        <- WIZ-04
   |                     catch -> open 127.0.0.1:8090/_/ (wrong port)  <- WIZ-05
   +- Step 2 Schema      collections only CHECKed, never created       <- WIZ-06
   |                     "Database setup complete!" even on failure    <- WIZ-06
   +- Step 3 Admin       users.create{...} is_active defaults false    <- WIZ-01
   |                     auto-login OK -> "Setup Complete!"
   +- Go to Dashboard    user_roles rules unsatisfiable -> perms = {}  <- WIZ-02
                         -> "Access Denied" (no error thrown)          <- WIZ-03
later:  logout -> login -> "Account is inactive"                       <- WIZ-01
        repair via upgrade-users-schema.ts -> backfill never fires     <- WIZ-09
```

## Static Reproduction (deterministic, no live server needed)

```powershell
# WIZ-02 - the rule constant cannot exist in a 15-char ID field
node -e "console.log('69993t907uvfn355'.length)"        # -> 16

# WIZ-01 - create payload omits is_active; AuthContext rejects false
findstr /n /c:"is_active" src\app\setup\page.tsx
findstr /n /c:"Account is inactive" src\contexts\AuthContext.tsx

# WIZ-09 - backfill predicate is unsatisfiable
findstr /n /c:"is_active ===" src\scripts\upgrade-users-schema.ts

# WIZ-07 - scripts pin :8090 while dev-all.js may use :8091
findstr /s /n /c:"127.0.0.1:8090" src\scripts\*.ts
```

**Runtime validation still outstanding** (requires a throwaway `--dir`, never the real `pb_data`): fresh-install migration apply, wizard end-to-end, interrupted wizard, duplicate submit, wrong superuser password, missing collections, and login-after-create. Scheduled in the companion plan.

---

## Recommended Remediation

Tracked step-by-step, with acceptance criteria and verification commands, in
**[`docs/SETUP_WIZARD_FIX_PLAN_2026-09-27.md`](./SETUP_WIZARD_FIX_PLAN_2026-09-27.md)**.

| Priority | Fix | Finding |
|---|---|---|
| 1 | Send `is_active: true` on admin create; fix the dead backfill | `WIZ-01`, `WIZ-09` |
| 2 | Replace the impossible role-ID constant with a name-based rule; add superuser escape hatch | `WIZ-02`, `WIZ-03` |
| 3 | Single source of truth for PB URL + credentials | `WIZ-04`, `WIZ-05`, `WIZ-07`, `WIZ-13` |
| 4 | Stop swallowing errors; make admin create idempotent | `WIZ-06`, `WIZ-08` |
| 5 | Add `pb:server-changed` re-check + retry affordance | `WIZ-10` |
| 6 | Runtime validation + smoke test; update docs | `WIZ-11`, `WIZ-12` |

---


## Caveats

1. **No runtime validation performed.** This session ran in read-only/plan mode; no PocketBase instance was started and `pocketbase/pb_data` was intentionally **not** touched. Findings are from static analysis plus verified environment facts.
2. **`WIZ-11` is an unverified risk**, not a confirmed defect.
3. **No test framework exists** in this repo, so the plan's validation step is manual/curl-driven unless a runner is added.
4. The live `pb_data` may already contain a role whose ID matches the `WIZ-02` constant, which would mask that defect **locally only**.
