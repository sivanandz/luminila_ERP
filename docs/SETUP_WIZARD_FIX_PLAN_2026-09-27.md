# First-Run Wizard & Admin Creation — Remediation Plan

**Date:** 2026-09-27
**Companion audit:** [`SETUP_WIZARD_AUDIT_2026-09-27.md`](./SETUP_WIZARD_AUDIT_2026-09-27.md)
**Owner:** Pixel Canary
**Definition of Done:** a clean machine with **no existing infrastructure** follows the documented steps and ends with an admin who can log out, log back in, and see the dashboard.

---

## Guiding Principles

1. **Idempotency everywhere.** Every provisioning step must be safe to re-run after an interruption. This is a cold-start wizard, so interruption is the norm, not the exception.
2. **Never report success for work that did not happen.** A `toast.success` must imply an observable state change.
3. **One source of truth** for the PocketBase URL and the superuser credential — derived, never duplicated.
4. **Fail loudly with a repair instruction.** Silent empty results (`WIZ-02`) are the worst failure class because they look like authorization design rather than a bug.
5. **Never validate against the real `pb_data`.** All runtime checks run against a throwaway `--dir`.

---

## Phase 1 — Unbreak the Cold Start (Critical) 🔴

### Task 1.1 — Create the admin as an active user (`WIZ-01`)

**Files:** `src/app/setup/page.tsx` (`handleCreateAdmin`, ~`:163-170`), `src/scripts/create-admin-user.ts` (`:33-40`)

Add `is_active: true` to both create payloads, matching `AuthContext.register()` (`AuthContext.tsx:100`).

```ts
await pb.collection("users").create({
    email: appAdmin.email,
    password: appAdmin.password,
    passwordConfirm: appAdmin.passwordConfirm,
    name: appAdmin.name,
    emailVisibility: true,
    verified: true,
    is_active: true,          // ← WIZ-01: bool defaults to false when omitted
});
```

**Acceptance:** after the wizard completes, `GET /api/collections/users/records?filter=(email='…')` returns `is_active: true`, **and a fresh `authWithPassword` succeeds**.

---

### Task 1.2 — Repair the dead `is_active` backfill (`WIZ-09`)

**File:** `src/scripts/upgrade-users-schema.ts:58-70`

`user.is_active === undefined || user.is_active === null` is unreachable for a persisted bool. Test for `false`, and — because existing rows are indistinguishable from intentionally-deactivated ones — only auto-enable rows the script can positively identify, and *report* the rest rather than mutating silently.

```ts
if (user.is_active === false) {
  await pb.collection("users").update(user.id, { is_active: true });
  repaired.push(user.email);
}
// ...then log repaired.length and list them; never claim a no-op as success.
```

**Acceptance:** run against a DB containing one `is_active:false` user → that user flips to `true` and is named in the output.

---

### Task 1.3 — Replace the unsatisfiable RBAC rule (`WIZ-02`, `WIZ-03`)

**Files:** `pocketbase/pb_migrations/1768109637_updated_roles.js`, `1768109637_updated_user_roles.js`; add **new** forward migrations (never edit an applied migration — PB tracks applied IDs).

**Defect:** the rule hardcodes role ID `69993t907uvfn355`, which is **16 chars** while `roles.id` is `[a-z0-9]{15}` — unsatisfiable on any fresh install.

**Preferred fix — bind by role *name*, not by ID** (survives reseed, import, and restore):

```js
const RULE = '@request.auth.id != "" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.role ?= "Admin"';
```

**Fallback** if ID binding is required: seed the Admin role with an *explicit valid* 15-char ID (e.g. `rol_admin_00001`) in `seed-roles.ts` and use that constant in one shared module.

> ⚠️ Confirm the `@collection.<name>.<relation>.<field>` traverses correctly on **PB 0.25.0** during Phase 4 before shipping — relation-field traversal in a subquery rule is the one part of this fix I could not verify statically.

**Acceptance:** on a **fresh** `pb_data`, a logged-in admin gets a non-empty `user_roles` list and the dashboard renders.

---

### Task 1.4 — Add a superuser escape hatch so lockout is never total (`WIZ-03`)

**File:** `src/components/auth/ProtectedRoute.tsx`

If `pb.authStore.isValid` and the RBAC lookup yields zero permissions, the app must not render a bare "Access Denied". Distinguish three states and label each:

| State | Message | Action offered |
|---|---|---|
| Not authenticated | "Please sign in" | → `/login` |
| Authenticated, 0 permissions | **"No roles assigned to this account"** | Re-run setup / contact superuser |
| Authenticated, insufficient | "You lack permission for this area" | → permitted page |

**Acceptance:** zero-permission state names the cause and offers a repair path.

---


## Phase 2 — Configuration Consistency (High) 🟠

### Task 2.1 — Derive the PocketBase URL instead of hardcoding it (`WIZ-05`)

**File:** `src/app/setup/page.tsx:98`, `:315`, `:356`

Replace all three literals with the existing resolver, so the wizard shows and opens *the server the app is actually using*:

```ts
import { getPocketBaseUrl } from "@/lib/pocketbase";
const pbUrl = getPocketBaseUrl();          // resolves env / LAN / emulator / tunnel
...
window.open(`${pbUrl}/_/`, "_blank");               // :98
{dbConnected ? pbUrl : "Start PocketBase first"}     // :315
<a href={`${pbUrl}/_/`} …>                           // :356
```

**Acceptance:** with `NEXT_PUBLIC_POCKETBASE_URL=http://192.168.1.20:8091`, the wizard displays that host and its admin-UI link points there.

---

### Task 2.2 — Make every script honour the configured URL (`WIZ-07`)

**Files:** `init-pocketbase.ts:3`, `seed-roles.ts:7`, `create-admin-user.ts:7`, `apply-pb-access-rules.ts:3`, `unlock-users-collection.ts:3`, `upgrade-users-schema.ts:3`

Adopt the pattern already proven in `fix-superuser-collections.ts:10`. Prefer a tiny shared helper so this cannot drift again:

```ts
// src/scripts/lib/pb-url.ts
export const PB_URL =
  process.env.NEXT_PUBLIC_POCKETBASE_URL || process.env.PB_URL || "http://127.0.0.1:8090";
```

Additionally, **print the URL it dialled and the failure cause** on connect error — on this machine `:8090` is held by `WsToastNotification` (HTTP 501), which currently surfaces as an opaque transport error.

**Acceptance:** start PB on `:8091` (as `dev-all.js:107-111` does), run `seed-roles.ts` → it connects to `:8091`.

---

### Task 2.3 — Single source of truth for the superuser credential (`WIZ-04`, `WIZ-13`)

**Files:** `src/app/setup/page.tsx:36-39` + the 6 scripts in 2.2 + `env.example.txt`, `.env.local`, `docs/POCKETBASE_SETUP.md`

Introduce `PB_SUPERUSER_EMAIL` / `PB_SUPERUSER_PASSWORD`; scripts read them, the wizard pre-fills the email only and **never ships a working password in source**. Remove `Admin@123456` from the bundle — note `NEXT_PUBLIC_*` vars are inlined into the client bundle, so the superuser password must **not** be a `NEXT_PUBLIC_*` var; require it to be typed, with a mismatch clearly diagnosed.

**Acceptance:** the wizard's connect failure says *"superuser credentials do not match"*, not a blind redirect to a new tab.

---

### Task 2.4 — Re-check connectivity on URL change (`WIZ-10`)

**File:** `src/app/setup/page.tsx`

Subscribe to the SDK's `pb:server-changed` event and add an explicit **Retry** button to the connection step so a wizard opened before PB was up can recover in place.

**Acceptance:** open `/setup` with PB down, start PB, click Retry → step advances without a page reload.

---


## Phase 3 — Honest Feedback & Idempotency (High/Med) 🟡

### Task 3.1 — Stop swallowing role-seed errors (`WIZ-06`)

**File:** `src/app/setup/page.tsx:124-135`

Replace `catch (err) { }` with per-role accounting; only toast success for roles actually created, surface real failures, and rename the final message to reflect reality — the wizard **checks** schema and **seeds** roles, it does not create collections.

```ts
let made = 0; const failed: string[] = [];
for (const r of DEFAULT_ROLES) {
  try { await pb.collection("roles").create(r); made++; }
  catch (e: any) { if (e?.status !== 400) failed.push(`${r.name}: ${e.message}`); }
}
if (failed.length) toast.error(`Roles failed: ${failed.join("; ")}`);
else toast.success(`${made} default roles ready`);
```

**Acceptance:** break the `roles` create rule → the wizard shows the failure instead of "Database setup complete!".

---

### Task 3.2 — Make admin creation idempotent (`WIZ-08`)

**File:** `src/app/setup/page.tsx:143-195`

Mirror the existence guard from `create-admin-user.ts:22-29`: if the email already exists, **adopt it** (offer "use existing account" / log in) rather than throwing a duplicate-email 400 with no exit. Wrap create and auto-login separately so a post-create login failure lands on an explicit "account created — sign in" screen rather than re-submitting.

**Acceptance:** submit twice → second submit logs in instead of erroring.

---

### Task 3.3 — Verify the `verified: true` risk (`WIZ-11`)

**Files:** `src/app/setup/page.tsx:169`, `src/scripts/create-admin-user.ts:39`

Resolve the open question from the audit against **PB 0.25.0 + SDK 0.26.5** in a throwaway instance (Phase 4). If create returns `validation_values_mismatch`, switch to create-then-`update` or the `POST /api/collections/users/records` + `verified` follow-up, and note it in `docs/POCKETBASE_SETUP.md`.

**Acceptance:** clean create on a fresh instance, or the workaround is in place and documented.

---

## Phase 4 — Runtime Validation (not yet performed) ⏳

All checks run against a **throwaway data dir** — the real `pocketbase/pb_data` is never touched:

```powershell
New-Item -ItemType Directory -Force -Path $env:TEMP\pb_wiz_validation | Out-Null
Start-Process -FilePath "$PWD\pocketbase\pocketbase.exe" `
  -ArgumentList "serve --dir=$env:TEMP\pb_wiz_validation --http=127.0.0.1:8099"
pocketbase\pocketbase.exe superuser upsert admin@test.local password123456
```

| # | Scenario | Expected |
|---|---|---|
| V1 | **Fresh install:** apply all 402 migrations to empty dir | succeeds; `roles`/`user_roles` rules match Task 1.3 |
| V2 | Wizard end-to-end (connect → schema → admin → dashboard) | dashboard renders, **not** Access Denied |
| V3 | **Login after logout** | succeeds (`is_active: true`) — proves `WIZ-01` fixed |
| V4 | Wrong superuser password | in-place inline error, no tab loop |
| V5 | Missing collections (schema step fails) | explicit repair instruction, no false success |
| V6 | Interrupted wizard, then re-run | completes without duplicate-record errors |
| V7 | Duplicate admin submit | logs into existing account (`WIZ-08`) |
| V8 | PB on `:8091` | wizard + all scripts target `:8091` |
| V9 | Admin create with `verified:true` on 0.25.0 | resolves `WIZ-11` either way |

**Blocking gate:** V1, V2, V3 must pass before this plan is considered complete.

---


## Phase 5 — Regression Guard & Documentation 🟢

### Task 5.1 — Add the missing smoke test (`WIZ-12`)

The repo has **no test runner**. Add the smallest valuable guard rather than a full suite: a static assertion that no migration hardcodes a role ID violating `[a-z0-9]{15}`, plus a scripted cold-start smoke test wired to a new npm script.

```js
// guard: every role-ID literal in a rule must be 15 chars of [a-z0-9]
const bad = [...src.matchAll(/role \?= "([^"]+)"/g)].map(m => m[1])
            .filter(v => !/^[a-z0-9]{15}$/.test(v));
if (bad.length) throw new Error("Unsatifiable role ID(s): " + bad.join(", "));
```

### Task 5.2 — Update documentation

- `docs/POCKETBASE_SETUP.md` — corrected first-run order, env vars, the `:8090`-occupied fallback, and the `69993t907uvfn355` defect with its fix.
- `README.md` — replace the stale wizard credentials/URL and the wizard's "creates the database" implication.
- `CODEBASE.md` — record the new shared `PB_URL` / credential helpers and the migration that supersedes `1768109637_*`.

---

## Sequencing & Effort

| Order | Task | Finding | Risk | Est. |
|---|---|---|---|---|
| 1 | 1.1 `is_active: true` | WIZ-01 | Low | 10 min |
| 2 | 1.3 role rule fix | WIZ-02/03 | **Med** (migration) | 45 min |
| 3 | 1.4 escape-hatch states | WIZ-03 | Low | 30 min |
| 4 | 2.1 + 2.2 URL derivation | WIZ-05/07 | Low | 45 min |
| 5 | 2.3 credential source of truth | WIZ-04/13 | Low | 30 min |
| 6 | 3.1 + 3.2 feedback/idempotency | WIZ-06/08 | Med | 60 min |
| 7 | 1.2 backfill fix | WIZ-09 | Low | 15 min |
| 8 | 2.4 reconnect listener | WIZ-10 | Low | 20 min |
| 9 | 4.x runtime validation | WIZ-11 | — | 60 min |
| 10 | 5.x tests + docs | WIZ-12 | Low | 45 min |

**Recommended split:** ship tasks **1–3** as an emergency fix (they alone make cold start usable), then **4–10** as a hardening pass.

---

## Regression Risks

1. **Never edit an applied migration** — PB records applied IDs; ship a new forward migration instead.
2. **Existing DBs may contain the 16-char role ID** (manually inserted). The fresh-install check does not cover that; add a data migration that rewrites the rule for *whatever* Admin role ID actually exists.
3. **`is_active` semantics** — enabling the field must not silently activate accounts an operator deliberately disabled (Task 1.2 reports rather than blanket-updates).
4. **`NEXT_PUBLIC_*` leakage** — never move the superuser password into a `NEXT_PUBLIC_*` var; it is inlined into the client bundle.
5. **Name-based rules add a read** — confirm `@collection.user_roles.role.role` traversal on PB 0.25.0 before shipping (Task 1.3).

## Out of Scope

- RBAC model redesign beyond the broken rule
- Replacing the wizard's schema-*checking* behaviour with real provisioning (noted in `WIZ-06`, separate decision)
- Non-first-run auth flows (password reset, OAuth, 2FA)
