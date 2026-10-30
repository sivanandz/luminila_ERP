# Single-Account Deployment (Niththigal) — 2026-10-29

A shipped deployment serves **one account**: Niththigal. One PocketBase database, one account
identity, no setup wizard. Multi-account (one PocketBase database per login email, plus per-email
tenant scoping) is an opt-in mode that can be re-enabled later without changing today's multi
code paths.

The switch lives in `src/lib/deployment-mode.ts`. It has no imports and touches neither Node nor
browser APIs, so client components and server routes resolve the same values:

| Export | Meaning |
|---|---|
| `getDeploymentMode()` | `'multi'` only when `TENANT_MODE` or `NEXT_PUBLIC_TENANT_MODE` trims to `multi` (case-insensitive); otherwise `'single'` |
| `isSingleAccountMode()` | `getDeploymentMode() === 'single'` |
| `isMultiAccountEnabled()` | `getDeploymentMode() === 'multi'` |
| `SINGLE_ACCOUNT_EMAIL` | The one account every record belongs to (`NEXT_PUBLIC_ACCOUNT_EMAIL` → `ACCOUNT_EMAIL` → `niththigal@gmail.com`, trimmed and lowercased) |
| `SINGLE_ACCOUNT_STORE_NAME` | `Niththigal` |

## 1. What single mode changes

| Area | Single (default) | Multi (opt-in) |
|---|---|---|
| Database resolution | Every path returns the primary PocketBase instance (`PB_URL` / `NEXT_PUBLIC_POCKETBASE_URL`, ports 8090/8091). No per-email lookup, no port allocation, no `pocketbase/pb_tenants/` directory, no registry writes. | One database per login email, resolved through `pocketbase/pb_tenants/registry.json` and ports 8092–8199. |
| Account identity | `account_email` is always `SINGLE_ACCOUNT_EMAIL` for stamps and filters, whichever user signed in. | `account_email` is the signed-in user's email. |
| Setup wizard | `/setup` redirects to `/login`; the login page does not link to it or offer "Check Setup"; `POST /api/system/tenant-db` refuses `mode:"provision"` with 403 (`src/app/api/system/tenant-db/route.ts:85-92`). | The wizard provisions a tenant database and its admin. |
| Fresh deployment | A boot hook (`src/lib/single-account-bootstrap.ts`, invoked from `src/instrumentation.ts`) creates the first admin, roles and store settings when the `users` collection is empty. | First login through `/setup` provisions. |
| Dev orchestrator | `scripts/dev-all.js` does not start the tenant databases listed in `pocketbase/pb_tenants/registry.json`. | Each registered tenant database is restored and started. |

Multi mode keeps today's behaviour exactly; nothing in the multi branch is rewritten by single
mode.

### What does not change

- Migrations, collections and API rules are the same in both modes. The `account_email` field and
  its rules stay; single mode only decides which value the application writes into it.
- The primary database is `pocketbase/pb_data/` in both modes. Single mode just never allocates a
  second one.
- `scripts/dev-all.js` still starts PocketBase, the WhatsApp sidecar and Next in the same order.
  In single mode it now logs one line —
  `Single-account mode: tenant databases are not started (set TENANT_MODE=multi to re-enable multi-account).`
  — and skips the registry restore.

## 2. Environment variables

| Variable | Default | Reaches | Notes |
|---|---|---|---|
| `TENANT_MODE` | unset → `single` | server, `scripts/dev-all.js` | `multi` opts into the multi-account model. Any other value, empty or whitespace means single. |
| `NEXT_PUBLIC_TENANT_MODE` | unset → `single` | browser bundle (inlined at build time) | Re-enabling multi needs **both** mode variables set to `multi` **and** a rebuild. Setting only the server variable at runtime leaves the browser in single mode. |
| `ACCOUNT_EMAIL` | `niththigal@gmail.com` | server only | The one account identity used for server-side stamps and filters. |
| `NEXT_PUBLIC_ACCOUNT_EMAIL` | `niththigal@gmail.com` | browser bundle | The copy the login prefill and client-side stamps use. **Must be the same address as `ACCOUNT_EMAIL` whenever either is set.** |
| `INITIAL_ADMIN_EMAIL` | `SINGLE_ACCOUNT_EMAIL` | boot hook | Honoured only when it equals `SINGLE_ACCOUNT_EMAIL`; otherwise the hook logs a warning, keeps `SINGLE_ACCOUNT_EMAIL`, and continues. |
| `INITIAL_ADMIN_PASSWORD` | unset | boot hook | Required on the first boot of a fresh database. Without it the hook cannot create the admin, and the deployment has no app login. |

`NEXT_PUBLIC_*` values are inlined into the browser bundle at build time. `ACCOUNT_EMAIL` is
server-only, which is why the two account-email variables must hold the same value: a deployment
that sets only `ACCOUNT_EMAIL` makes the server stamp rows under one address while the browser
keeps writing for the default one.

> **The login must be `SINGLE_ACCOUNT_EMAIL`.** PocketBase's collection rules compare a record's
> `account_email` with `@request.auth.email`. If an operator signs in as a different address, every
> create is rejected with `400 Failed to create record.` and reads return only the rows stamped with
> their own address. The default is `niththigal@gmail.com`, the production account.

PocketBase connectivity (`PB_URL`, `NEXT_PUBLIC_POCKETBASE_URL`, `POCKETBASE_SUPERUSER_EMAIL`,
`POCKETBASE_SUPERUSER_PASSWORD`) is unchanged; see `env.example.txt` and
`docs/POCKETBASE_SETUP.md`.

## 3. Fresh VPS bring-up without the wizard

Single mode has no wizard, so a fresh deployment is brought up in two layers:

1. **Database administrator (PocketBase superuser).** PocketBase ships without a default admin.
   Create one against the data directory:
   ```bash
   pocketbase superuser upsert admin@example.com '<strong-password>' --dir=pocketbase/pb_data
   ```
   or open `http://127.0.0.1:8090/_/` and create it there. The superuser administers the database
   (collections, rules, backups); it is not the store account and does not log into the ERP's
   business collections.
2. **Store account (the one app login).** Set `INITIAL_ADMIN_PASSWORD` and, on a fresh database,
   `INITIAL_ADMIN_EMAIL` to the account address (it is honoured only when it equals
   `SINGLE_ACCOUNT_EMAIL`). If the account is not the default, set both `ACCOUNT_EMAIL` and
   `NEXT_PUBLIC_ACCOUNT_EMAIL` to the same address.
   PocketBase applies `pocketbase/pb_migrations/` when it starts. On the first boot of the Next
   server, when `users` is empty, the hook creates the user whose email is
   `SINGLE_ACCOUNT_EMAIL`, seeds the role records, and writes the store settings with
   `store_name = Niththigal`. It is idempotent: once a user exists it does nothing. If PocketBase
   is not reachable yet, it retries briefly and then logs the remediation instead of failing
   silently.

Then start the stack (dev: `node scripts/dev-all.js`; production: PocketBase `serve` plus the Next
server) and sign in at `/login` with `SINGLE_ACCOUNT_EMAIL`.

Verification on a fresh deployment:

- `curl http://127.0.0.1:8090/api/health` returns `{"code":200,...}`.
- `GET /api/system/tenant-db` returns `{success:true, pbUrl:...}` for the primary instance.
- `POST /api/system/tenant-db` with `{"mode":"provision",...}` returns 403.
- `/setup` redirects to `/login`.
- The `users` collection has exactly the one account and `store_settings` has
  `key="store_name"` → `Niththigal` for `SINGLE_ACCOUNT_EMAIL`.

## 4. Existing data: one-time scope reconciliation

**Decision.** The scope that owns the deployment is `SINGLE_ACCOUNT_EMAIL` — by default
`niththigal@gmail.com`. It owns the storefront content and the legacy rows whose `account_email`
was written under a previous login. Changing the account address on an existing database without
moving those rows leaves the CMS editor on its defaults and the ERP on an empty catalog.

On 2026-10-29 the WhatsApp data was reconciled to the production account: all 28 `whatsapp_chats`
rows, 957 `whatsapp_messages` rows and 8 `customers` rows now carry `niththigal@gmail.com`. That
removed a `validation_not_unique` conflict where a global `chat_id` index collided with rows that
the signed-in account could not see. Other collections were not swept; if the catalog, CMS or
settings still show a mixed scope, run the procedure below.

The design review read `pocketbase/pb_data/data.db` (read-only) on 2026-10-29 and found:

| Data | Scope(s) present |
|---|---|
| `products` | `admin@luminila.local` (3 rows), `niththigal@gmail.com` (1 row) |
| `store_settings` `store_name` | `admin@luminila.local`, `niththigal@gmail.com`, `ananya@…` |
| `storefront_content` | one row (356,829 bytes) under `admin@luminila.local` |
| `customers` | one row stamped `admin@luminila.internal` (the old storefront default) |

With the default owner, the `niththigal@gmail.com`, `ananya@…` and `admin@luminila.internal` rows
sit outside the account: an operator login does not see them. Decide for each one whether it
should be moved or dropped, then run the re-stamp **once** before switching users over.

Re-stamp procedure:

1. Stop PocketBase and the Next server. Copy `pocketbase/pb_data/data.db` aside.
2. Inventory what is outside the owner scope (repeat per collection that has `account_email`):
   ```sql
   SELECT account_email, count(*) FROM products GROUP BY account_email;
   ```
3. Move the rows that belong to the account:
   ```sql
   UPDATE products SET account_email = 'admin@luminila.local'
    WHERE COALESCE(account_email, '') <> 'admin@luminila.local';
   ```
   Use the configured `SINGLE_ACCOUNT_EMAIL` in place of the literal. Do not delete the old
   scope until the backup is confirmed.
4. De-duplicate key/value rows in `store_settings` (`store_name`, `storefront_content`, …) so the
   account has one row per key after the move; the app reads the first matching key.
5. Restart and sign in as `SINGLE_ACCOUNT_EMAIL`; verify the catalog, the CMS editor and the
   storefront all show the same data.

Collections with unique document-number indexes (`invoice_number`, `order_number`, `po_number`,
`grn_number`, `credit_note_number`, `expense_number`, `challan_number`, `number_sequences.name`)
abort the whole `UPDATE` on a collision. If numbering restarted per scope, resolve the duplicate
numbers first.

`''` rows need the same treatment. The premise that the rules already treat `admin@luminila.local`
as the owner of blank rows holds only where a collection's active rule carries that legacy case
(`store_settings` does: `1792774206_store_settings_rules.js:22-33`). The active `products` rules
require an exact match (`1792415991_updated_products.js:7-8`), so a blank product row is invisible
until it is re-stamped.

## 5. Known limitations

### 5.1 A non-primary login cannot write — and sees only its own scope

The PocketBase collection rules scope rows by the caller's login email. For `products`
(`1792406707_updated_products.js:7-11`; the same shape is applied across the migration bundle):

- create: `@request.auth.id != "" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email)`
- list / view / update / delete: `@request.auth.id != "" && account_email = @request.auth.email`

In single mode the application stamps and injects `account_email = SINGLE_ACCOUNT_EMAIL`. A login
whose email is not `SINGLE_ACCOUNT_EMAIL` therefore:

- fails every create with **403**, because the injected `account_email` does not equal
  `@request.auth.email`;
- sees only rows stamped with its own email (normally none of the account's data), and cannot
  update or delete the account's rows, because the rules compare the stored `account_email` with
  the caller's email rather than with the deployment's account scope. A staff login only sees the
  account's data once those rules compare against the user's account scope instead of its email.

The live database already has an active `niththigal@gmail.com` login. Treat it as a login scoped to
its own email, not a second owner: the supported way to operate the deployment is to sign in as
`SINGLE_ACCOUNT_EMAIL`. Making staff logins write requires a rule migration that compares against
an account-scope field instead of `@request.auth.email` — a schema change, not a setting.

### 5.2 The two account-email variables must agree

Only `NEXT_PUBLIC_ACCOUNT_EMAIL` is inlined into the browser bundle; `ACCOUNT_EMAIL` is server-only.
Setting only `ACCOUNT_EMAIL` gives the server one owner while the browser keeps the default
identity (login prefill and client-side stamps), so UI writes land in a different scope. Set both,
or neither.

### 5.3 Re-enabling multi needs a rebuild

`NEXT_PUBLIC_TENANT_MODE` is baked into the browser bundle at build time. Setting `TENANT_MODE` on
the server alone leaves the client in single mode.

### 5.4 Existing rows are not moved automatically

Section 4 is a manual, one-time step. Nothing in the boot hook rewrites `account_email`.

### 5.5 Tenant databases are kept, not deleted

Single mode ignores `pocketbase/pb_tenants/` and `registry.json`. Leave them in place: they are the
rollback path for multi mode, and they may still hold the only copy of rows that were never
re-stamped.

## 6. Turning multi-account back on

1. Set both `TENANT_MODE=multi` and `NEXT_PUBLIC_TENANT_MODE=multi` (shell or `.env.local`;
   `scripts/dev-all.js` reads `.env.local` for these two keys and an exported shell value wins).
2. Rebuild the client and the desktop/mobile artifact, because the public variable is inlined.
3. Keep `pocketbase/pb_tenants/registry.json` and each tenant's data directory. `node
   scripts/dev-all.js` restores and starts them again under multi mode; production deployments
   continue to provision through `POST /api/system/tenant-db`.
4. `/setup`, the provisioning API and per-email tenant resolution become available again.
5. If the single account's rows must also be visible to another login, re-stamp or re-provision
   them per the rules above.

## 7. References

| Concern | File |
|---|---|
| Mode flag and account constants | `src/lib/deployment-mode.ts` |
| Fresh-deployment boot hook | `src/lib/single-account-bootstrap.ts`, called from `src/instrumentation.ts` |
| Provisioning API single-mode refusal | `src/app/api/system/tenant-db/route.ts:44-46`, `:85-92` |
| Primary port discovery (8091 preferred, then 8090) | `src/lib/tenant-db-manager.ts:138-144` |
| Default PocketBase URL | `src/lib/pocketbase.ts:6` |
| Tenant restore gate in development | `scripts/dev-all.js` |
| Row rules | `pocketbase/pb_migrations/1792406707_updated_products.js`, `1792415991_updated_products.js`, `1792774206_store_settings_rules.js` |
