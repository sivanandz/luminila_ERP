# Wave 2 — Identity, tenancy, auth boundaries, settings, non-channel API routes

Date: 2026-11-17
Scope: `src/lib` identity/tenancy/auth/settings modules, `src/app/api/{ai,analytics,setup,settings,system,inventory,tracking}`, `src/app/{login,setup,users,customers,settings}`, plus the auth shell (`proxy.ts`, `AuthContext`, `AuthGate`, `ProtectedRoute`, `usePermissions`, `instrumentation.ts`) and the PocketBase rule migrations those paths depend on.

Deployment context used for severity: the shipped configuration is single-account (`TENANT_MODE`/`NEXT_PUBLIC_TENANT_MODE` unset, `deployment-mode.ts:76-78`). Findings marked **multi-account only** are inert in the shipped configuration but are live if `TENANT_MODE=multi` is re-enabled.

Counts: **CRITICAL 0 · HIGH 4 · MEDIUM 5 · LOW 3**

| ID | Severity | Title |
|----|----------|-------|
| T-01 | HIGH | Payment-gateway secrets are returned to every staff browser and readable by any tenant member |
| T-02 | HIGH | `store_settings` has no role check: any tenant member can rewrite/delete tax, bank and gateway configuration |
| T-03 | HIGH | `createTenantClient` throws in production on a plaintext environment superuser password |
| T-04 | HIGH | Storefront catalog accepts a request-supplied tenant email and builds a superuser client (multi-account only) |
| T-05 | MEDIUM | `/customers` has no permission gate: read-only roles can write customers, loyalty value, loyalty economics and discounts |
| T-06 | MEDIUM | Rate-limit client key trusts caller-controlled forwarding headers |
| T-07 | MEDIUM | Multi-account login can never resolve a tenant database |
| T-08 | MEDIUM | Tenant-db GET wakes/registers a tenant database before authenticating |
| T-09 | MEDIUM | E-way Bill settings update always sends `account_email`, which the tenant body guard rejects |
| T-10 | LOW | Tenant-db POST "provisioning disabled" gate is bypassed by any non-exact-case `mode` |
| T-11 | LOW | Tenancy guards fail open on records with an empty `account_email` |
| T-12 | LOW | Inventory template route verifies tokens against the primary DB in multi-account mode |

---

### T-01 [HIGH] Payment-gateway secrets are returned to every staff browser and readable by any tenant member — `src/lib/settings.ts:126`

**What the code does**

`getStoreSettings()` reads the tenant's canonical `store_settings` row and returns the whole parsed `value` to the caller. The only redaction is applied to the localStorage copy:

```ts
// src/lib/settings.ts:126
const CLIENT_SECRET_FIELDS = [
    "razorpayKeySecret",
    "razorpayWebhookSecret",
    "phonepeSaltKey",
    "shopifyToken",
] as const;

function stripClientSecrets(settings: Record<string, unknown>): Record<string, unknown> {
    const clone = { ...settings };
    for (const field of CLIENT_SECRET_FIELDS) delete clone[field];
    return clone;
}
```

```ts
// src/lib/settings.ts:185
const rawValue = (record as { value?: unknown } | null)?.value;
if (rawValue) {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    if (parsed && typeof parsed === "object") {
        if (typeof window !== "undefined") {
            localStorage.setItem(
                `luminila_settings_${storageId}`,
                JSON.stringify(stripClientSecrets(parsed))
            );
        }
        return normalizeLoadedSettings(parsed as Record<string, unknown>, defaults);
    }
}
```

`saveStoreSettings()` stores the full settings object, secrets included, in the same row:

```ts
// src/lib/settings.ts:258
const payload = {
    key,
    value: settings,
    category: "store_config",
    ...
};
```

The row's read rule has no role condition. The final rule is produced by `1793001500_tenant_rules_dual_identity.js:58-77` (`store_settings` is in `strictCollections`) and `1793003100_tenant_update_guards_and_otp_seal.js:122-133`, which only appends the `account_email` body guard:

```js
"listRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
"viewRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
"updateRule": `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false`,
```

`TENANT_MEMBER` is `(@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email))` (`1793001500:21-22`). A cashier/staff/viewer account satisfies it because `account_email` is the tenant owner's email (`createAppUser` stamps the owner, `src/lib/app-users.ts:17-32`).

**Why wrong**

Expected: only an administrator (the `settings:update` capability that gates the Settings page) can see payment-gateway credentials, and no browser receives them except through the E-way-style reveal endpoint.

Actual: every authenticated tenant member can read them. The values are not merely reachable via raw REST; normal staff pages request them. `getStoreSettings()` is called by the POS page and stored whole in React state:

```ts
// src/app/pos/page.tsx:1147
useEffect(() => {
    getStoreSettings()
        .then((settings) => {
            if (!cancelled) {
                setGstRegistered(settings.isGstRegistered !== false);
                setStoreSettingsData(settings as typeof storeSettingsData);
            }
        })
```

Concrete scenario: a Staff or Viewer account opens the POS screen (not even permission-gated, `src/app/pos/page.tsx:208`), and the browser heap now contains `razorpayKeySecret`, `razorpayWebhookSecret`, `phonepeSaltKey` and `shopifyToken`. The same user can also `GET /api/collections/store_settings/records` directly. The `settings.ts` comment says these fields "must never be mirrored into browser localStorage, where any XSS can read them" — the localStorage copy is stripped but the object returned from the same function is not, so the intent is only half implemented.

**Evidence**

- Full read of `src/lib/settings.ts` (all callers below).
- Caller grep (`getStoreSettings(`): `src/app/pos/page.tsx:1149`, `src/app/orders/detail/page.tsx:79`, `src/app/labels/page.tsx:459`, `src/app/invoices/detail/page.tsx:121`, `src/app/invoices/create/page.tsx:122`, `src/app/returns/detail/page.tsx:127`, `src/app/challan/create/page.tsx:92`, and several `src/lib/*` helpers used by those pages. None of these pages is administrator-only.
- Rule trace: `1793001500_tenant_rules_dual_identity.js:58-77`, `1793003100_tenant_update_guards_and_otp_seal.js:122-133`; no later migration touches `store_settings` (`1793003200` and `1793003400` do not).
- The Settings page gate is client-side only (`src/app/settings/page.tsx:569-586`), so it neither protects the row read nor the row write (see T-02).

**Minimal fix**

1-2 lines: have `getStoreSettings()` return a redacted object (`apply stripClientSecrets` to what it returns) and expose secrets only through an admin-only reveal route (mirror `src/app/api/settings/eway/route.ts:115-127`).

**Confidence:** confirmed (code + rules). Exposure requires the canonical `store_config` row to exist, i.e. the normal case after Settings has been saved with gateway keys.

---

### T-02 [HIGH] `store_settings` has no role check: any tenant member can rewrite/delete tax, bank and gateway configuration — `src/app/settings/page.tsx:569`

**What the code does**

The Settings screen refuses to render without the capability:

```tsx
// src/app/settings/page.tsx:569
if (!isAdmin && !hasPermission("settings", "update")) {
    return (
        ... "Administrator access required" ...
    );
}
```

But the write goes straight to PocketBase with the user's own token (`saveStoreSettings`, `src/lib/settings.ts:212-277`), and the collection rules contain no role predicate (quoted in T-01). `createRule`/`updateRule` only require a tenant-matching `account_email`:

```js
// 1793001500_tenant_rules_dual_identity.js:71-76 (store_settings)
"createRule": `@request.auth.id != "" && ${TENANT_BODY_OWNER}`,
"updateRule": `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false`,
"deleteRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
```

**Why wrong**

Expected: `settings:update` is the authorization boundary for tax identity, bank details and payment credentials (the page says exactly that: "Store settings include tax, payment and integration credentials").

Actual: the check is client-side only. Any tenant member, including a Viewer whose role grants `settings: []` (`src/lib/setup.ts:109-112`), can issue `PATCH /api/collections/store_settings/records/<row>` with `{"value": {...}}` and change:

- `gstin`, `stateCode`, `isGstRegistered` — the tax identity and place-of-supply used to compute CGST/SGST/IGST on invoices;
- `bankName`, `accountNumber`, `ifsc` — printed on invoices for customer payment;
- `razorpayKeySecret`/`razorpayWebhookSecret`/`phonepeSaltKey` — redirect payment settlement or break webhook verification;
- delete the row entirely (`deleteRule` is tenant-only), reverting the store to defaults.

Concrete scenario: a cashier on the POS terminal PATCHes `value.stateCode` from `27` to `29` and `value.gstin` to another GSTIN; every subsequent invoice is generated with the wrong tax jurisdiction/registration. No client page is involved and no server route logs it.

The settings page's `handleSave` (`src/app/settings/page.tsx:390-401`) does not re-check the capability either (unlike the users page, which re-checks in its handlers at `src/app/users/page.tsx:126-167`), so an XSS or a console call bypasses the page gate completely.

**Evidence**

- Full read of `src/app/settings/page.tsx` and `src/lib/settings.ts`.
- Rules: `pocketbase/pb_migrations/1793001500_tenant_rules_dual_identity.js:58-77`; guard-only change in `1793003100_tenant_update_guards_and_otp_seal.js:111-137`; no later role predicate in `1793003200`/`1793003400`.
- `saveStoreSettings` is only imported by the settings page (grep), so the intended gate is UI-only; the data plane accepts the same PATCH from any tenant token.
- `pb.beforeSend` (`src/lib/pocketbase.ts:247-258`) only stamps creates (`POST`), so a PATCH body is accepted as-is.

**Minimal fix**

Add `settings:update` (Admin role, or tenant owner) to `store_settings` `createRule`/`updateRule`/`deleteRule`, or move the write behind an authenticated route that calls `hasCapability(session,'settings','update')` and writes with a server client.

**Confidence:** confirmed.

---

### T-03 [HIGH] `createTenantClient` throws in production on a plaintext environment superuser password — `src/lib/pocketbase.ts:112`

**What the code does**

Every server-side tenant client in single-account mode is built from the environment credentials:

```ts
// src/lib/pocketbase.ts:133
if (isSingleAccountMode()) {
    const singleClient = new PocketBase(getPocketBaseUrl());
    singleClient.autoCancellation(false);
    await authenticateTenantClient(
        singleClient,
        process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_ADMIN_EMAIL || '',
        process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_ADMIN_PASSWORD || ''
    );
    return singleClient;
}
```

and `authenticateTenantClient` runs the **registry** plaintext policy on that environment value, outside its try/catch:

```ts
// src/lib/pocketbase.ts:109
async function authenticateTenantClient(client: PocketBase, email: string, password: string): Promise<void> {
    if (!email || !password) return;
    // Values may be plaintext (legacy registry) or enc:v1: ciphertext.
    const secret = readRegistrySecret(password);
    try {
        await client.collection("_superusers").authWithPassword(email, secret);
    } catch {
        await client.collection("users").authWithPassword(email, secret).catch(() => {});
    }
}
```

```ts
// src/lib/tenant-secrets.ts:68
export function readRegistrySecret(value: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
    if (!value) return '';
    if (env.NODE_ENV === 'production' && !isEncryptedSecret(value)) {
        throw new Error(
            'Registry value is stored in plaintext; encrypt it with TENANT_REGISTRY_KEY before running in production.'
        );
    }
    return decryptSecret(value, parseRegistryKey(env.TENANT_REGISTRY_KEY));
}
```

**Why wrong**

Expected: the production refusal exists for **registry rows** (`registry.json`), which the app writes. Environment variables are supplied by the operator/deployment and are plaintext by convention; `ensureServerAuth` (`src/lib/pocketbase.ts:313-321`), `single-account-bootstrap.ts:141-142` and `getServerTenantPocketBaseConfig` (`tenant-db-manager.ts:639-651`) all consume the same variables without decrypting them.

Actual: `readRegistrySecret` is applied to the environment password. In a production build (`NODE_ENV=production`; `.next/standalone/server.js:5` sets exactly that, and the Tauri release spawns that entry, `src-tauri/src/lib.rs:56-95`), a plaintext `POCKETBASE_SUPERUSER_PASSWORD` makes `createTenantClient()` reject with "Registry value is stored in plaintext…". Every server path that builds a tenant client then fails: storefront catalog/content/order/OTP (`api/storefront/**`, `otp-store.ts`, `storefront-tenant.ts`, `storefront.ts`), `api/inventory/template`, `api/catalog/feed|image`, and the AI admin-client fallback. The repository's `.env.local` sets `POCKETBASE_SUPERUSER_PASSWORD` to a plaintext value, and the documented deployment does the same.

I executed the policy in isolation to remove doubt:

```
NODE_ENV=production readRegistrySecret('<plaintext env password>', {NODE_ENV:'production'})
-> THREW: Registry value is stored in plaintext; encrypt it with TENANT_REGISTRY_KEY before running in production.
```

(The throw comes from `readRegistrySecret` before any network call, so `createTenantClient` cannot reach its authentication fallback.)

**Evidence**

- Full read of `src/lib/pocketbase.ts`, `src/lib/tenant-secrets.ts`.
- Caller grep of `createTenantClient`: `src/app/api/storefront/{catalog,content,order,auth/*}`, `src/app/api/catalog/{feed,image}`, `src/app/api/inventory/template`, `src/lib/{otp-store,storefront,storefront-tenant}.ts`, `src/lib/ai/http.ts`.
- Runtime proof above; `.env.local` key names only (value not reproduced).
- `test-tenant-secrets.ts:74-84` asserts the production refusal, but only for registry-style values; no test exercises `createTenantClient` with environment credentials, which is the gap.

**Minimal fix**

In `authenticateTenantClient`, decrypt only encrypted values: `const secret = isEncryptedSecret(password) ? readRegistrySecret(password) : password;` (and the same in `adminCredentialsForUrl`, `src/lib/ai/http.ts:194`, for the env fallback).

**Confidence:** confirmed for the code behaviour; the outage follows whenever the production environment carries a plaintext superuser password (the documented and repository configuration).

---

### T-04 [HIGH] Storefront catalog accepts a request-supplied tenant email and builds a superuser client — `src/lib/storefront-tenant.ts:34`

**What the code does**

```ts
// src/lib/storefront-tenant.ts:24
export async function resolveStorefrontTenant(
    hintEmail?: string
): Promise<StorefrontTenant> {
    if (isSingleAccountMode()) {
        return { email: SINGLE_ACCOUNT_EMAIL, client: await createTenantClient() };
    }

    let email = (hintEmail || "").trim().toLowerCase() || DEFAULT_STOREFRONT_TENANT_EMAIL;

    let client = await createTenantClient(email);
    ...
    if (bound && bound !== email) {
        email = bound;
        client = await createTenantClient(email);
    }
```

The public catalog route passes raw request input into it:

```ts
// src/app/api/storefront/catalog/route.ts:62
const hintEmail =
    req.nextUrl.searchParams.get("account_email") ||
    req.headers.get("x-account-email") ||
    undefined;
const { email: boundAdminEmail, client } =
    await resolveStorefrontTenant(hintEmail);
```

**Why wrong**

Expected: a public (sessionless) route may only address a tenant on a server-side allowlist. The codebase has that control and uses it elsewhere: `resolvePublicStorefrontTenant` (`src/lib/storefront.ts:44-53`) returns `""` unless the email is in `STOREFRONT_TENANTS`/`STOREFRONT_TENANT_EMAILS`, and `send-otp`/`verify-otp`/`content`/`flash-drop`/`order` all use it.

Actual: `resolveStorefrontTenant` has no allowlist and `createTenantClient(email)` in multi-account mode is a **superuser** client for that email (`pocketbase.ts:159-172` + `tenant-db-manager` registry lookup). An anonymous `GET /api/storefront/catalog?account_email=<registered merchant>` therefore opens that merchant's database with superuser credentials and returns their catalog: SKUs, names, website prices, stock levels per variant, gallery URLs (`catalog/route.ts:155-236`). No session is required. In single-account mode the hint is ignored, so this is not exploitable in the shipped configuration.

Concrete scenario (multi-account deployment): the attacker knows merchant `owner@shop.in`; `GET /api/storefront/catalog?account_email=owner@shop.in` returns that store's inventory and stock. The isolated tenant databases (`ensureTenantPocketBaseRunning`) are even started on demand by this call.

**Evidence**

- Full read of `src/lib/storefront-tenant.ts`, `src/lib/storefront.ts`, `src/lib/public-surfaces.ts`; read of `src/app/api/storefront/catalog/route.ts` (tenant-resolution and product-mapping sections).
- Caller grep: only `src/app/api/storefront/catalog/route.ts:70` uses `resolveStorefrontTenant`; the other public routes use the allowlisted `resolvePublicStorefrontTenant` (grep listed above), which shows the missing control is specific to this path.
- Single-account guard at `storefront-tenant.ts:27-32` is why this is marked multi-only.

**Minimal fix**

Route the hint through `resolvePublicStorefrontTenant(hintEmail)` before `createTenantClient`, and fail closed when it returns `""` (or drop the hint parameter entirely and resolve from the bound `storefront_content` row).

**Confidence:** confirmed (multi-account only).

---

### T-05 [MEDIUM] `/customers` has no permission gate: read-only roles can write customers, loyalty value, loyalty economics and discounts — `src/app/customers/page.tsx:144`

**What the code does**

The page is not wrapped in `ProtectedRoute` and its only permission use is the campaign dispatcher:

```tsx
// src/app/customers/page.tsx:144
export default function CustomersPage() {
    const router = useRouter();
    // PG-19: dispatching campaign messages is destructive ...
    const { hasPermission, isAdmin } = usePermissions();
    const canDispatchCampaigns = () => isAdmin || hasPermission("customers", "update");
```

Everything else is ungated: the "Add Customer" button (`page.tsx:781-787`), `handleAddCustomer` (`page.tsx:477-515`), promo creation (`page.tsx:316-342`), the loyalty configuration modal (`page.tsx:180-198`), and on the detail page `updateCustomer`, `updateCustomerJewelryProfile`, `deleteCustomer` and `adjustPoints` (`src/app/customers/detail/page.tsx:209-298`, no `usePermissions` import at all).

The data plane agrees: `customers` create/update are tenant-only (`1793001500_tenant_rules_dual_identity.js:71-76`); `loyalty_accounts` update is tenant-only (`1792410187_updated_loyalty_accounts.js:7-11`); `loyalty_settings` update is tenant-only (`1792415991_updated_loyalty_settings.js:7-11`); `discounts` create/update are tenant-only (`1792410187_updated_discounts.js:7-11`). Only deletes were hardened (`1793003200_rbac_data_plane_delete_guards.js:11-25`).

**Why wrong**

Expected: the RBAC catalog says a Viewer has `customers: ["read"]` and `settings: []` (`src/lib/setup.ts:109-112`); a Manager has `settings: ["read"]` only. Read-only means read-only.

Actual: any signed-in tenant member (including a zero-role account, since `AuthGate` only checks `isValid`, `src/components/auth/AuthGate.tsx:21-22`) can open `/customers` by URL and then:

- create or edit customer PII (phone, email, GSTIN, addresses);
- add/subtract loyalty points on any customer (`adjustPoints` from the detail page) and change `points_per_rupee`, `redemption_value`, `max_redemption_percent`;
- create a percentage discount code with no value cap (`handleCreatePromo` only requires `val > 0`), then use it at POS.

Concrete scenario: a Viewer on a shared terminal opens `/customers`, adjusts a friendly customer's loyalty balance by +100000 points (redeemable at the configured rate), or creates promo `FREE100` with `value: 100`. The API accepts it because the rules never consult the caller's roles.

**Evidence**

- Read of `src/app/customers/page.tsx:140-540,772-796` and `src/app/customers/detail/page.tsx:1-330`; grep of the remaining JSX for `ProtectedRoute|hasPermission|isAdmin|usePermissions` (no other hits).
- Rule trace quoted above; `1793003100` only freezes `account_email`.
- `AuthGate` (full read) is the only route-level guard and it checks session validity, not permissions. `/users` by contrast is wrapped in `ProtectedRoute` (`src/app/users/page.tsx:510-516`).

**Minimal fix**

Add `settings:update` (Admin) to `loyalty_settings`/`loyalty_accounts`/`discounts` writes and `customers:create|update` to `customers` writes, or wrap the customer pages in `ProtectedRoute` and make the data-plane rules role-aware; the UI gate alone is not a boundary.

**Confidence:** confirmed.

---

### T-06 [MEDIUM] Rate-limit client key trusts caller-controlled forwarding headers — `src/lib/rate-limit.ts:125`

**What the code does**

```ts
export function clientKeyFromHeaders(headers: Headers): string {
    const cfConnectingIp = headers.get('cf-connecting-ip')?.trim();
    if (cfConnectingIp) return cfConnectingIp;

    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
        const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
        if (hops.length > 0) {
            const index = Math.max(0, hops.length - 1 - trustedProxyHops());
            const client = hops[index];
            if (client) return client;
        }
    }
    const direct = headers.get('x-real-ip')?.trim();
    if (direct) return direct;
    return `direct:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
```

`TRUSTED_PROXY_HOPS` defaults to `0` (`rate-limit.ts:112-115`), so a request with one `x-forwarded-for` entry uses that entry verbatim.

**Why wrong**

Expected: the limiter keys on the address the platform observed, or on a header only a trusted proxy can set. The comment says the right-most XFF entry is "the hop our own proxy appended" — true only when a proxy actually appended it.

Actual: `cf-connecting-ip`, `x-forwarded-for` and `x-real-ip` are all accepted without evidence that a trusted proxy is in front. On any path where the Next server is reachable directly (LAN/Tailscale admin surface, `next dev`, the Tauri local server, or a deployment without Cloudflare), a caller sets `cf-connecting-ip: <random>` on every request and gets a fresh bucket, defeating the OTP-send (20/10 min, `send-otp/route.ts:19-22`), tracking (30/min, `st-courier/route.ts:6`) and tenant-db provision (5/10 min, `tenant-db/route.ts:21-29`) limits. Setting the header to a victim's address instead lets one caller exhaust the victim's window (targeted denial of service on OTP login).

Concrete scenario: an attacker rotating `cf-connecting-ip` sends unlimited OTP requests; the per-phone daily cap is the only remaining control, and they can rotate phone numbers too.

**Evidence**

- Full read of `src/lib/rate-limit.ts`.
- Callers: `src/app/api/storefront/auth/send-otp/route.ts:30`, `src/app/api/tracking/st-courier/route.ts:14`, `src/app/api/system/tenant-db/route.ts:27`, plus `flash-drop/route.ts:83`.
- `src/scripts/test-rate-limit.ts:67-87` covers only `x-forwarded-for` (with/without hops) and `x-real-ip`; it never sends `cf-connecting-ip`, so the unconditional trust is untested.
- `proxy.ts:31-35` itself distinguishes "behind a proxy" (`x-forwarded-host`/`x-forwarded-for` present) from a direct caller, showing the app is expected to serve both kinds of traffic.

**Minimal fix**

Only trust `cf-connecting-ip`/XFF when a trusted-proxy setting is enabled (e.g. `TRUSTED_PROXY_HOPS > 0` or `TRUST_PROXY_HEADERS=1`); otherwise key on the request's peer address (or a per-request random bucket) instead of caller-supplied headers.

**Confidence:** confirmed (code); exploitability depends on whether the limiter-protected routes are reachable without Cloudflare, which the LAN/Tailscale deployment is.

---

### T-07 [MEDIUM] Multi-account login can never resolve a tenant database — `src/app/api/system/tenant-db/route.ts:75`

**What the code does**

```ts
// GET /api/system/tenant-db
const resolved = await resolveTenantDatabase(targetEmail, { activate: false });

const session = await authenticateOperator(req, targetEmail);
if (targetEmail && session.ok && tenantAccessAllowed(session.email, session.isSuperuser, targetEmail)) {
    return NextResponse.json(resolved);
}
return NextResponse.json({ success: false, error: 'Authentication required ...' }, { status: 401 });
```

`authenticateOperator` returns 401 immediately when there is no bearer token (`src/lib/api-auth.ts:51-54`). The browser calls this endpoint **before** login:

```ts
// src/lib/pocketbase.ts:534
const endpoint = cleanEmail
    ? `/api/system/tenant-db?email=${encodeURIComponent(cleanEmail)}`
    : "/api/system/tenant-db";
const res = await fetch(endpoint);
if (res.ok) { ... setPocketBaseUrl(clientUrl) ... }
```

```ts
// src/contexts/AuthContext.tsx:130
await resolveTenantPocketBase(email);
await autoDiscoverPocketBase();
authData = await pb.collection("users").authWithPassword(email, password);
```

**Why wrong**

The route's own comment says "The login screen runs before a session exists, so the lookup itself stays open" (`route.ts:56-59`), but the code requires a session. In multi-account mode `resolveTenantPocketBase` gets 401, falls back to the default URL, and `autoDiscoverPocketBase` probes only `127.0.0.1:8090` (`pocketbase.ts:631-649`). A user whose database lives on a tenant port (8092-8199) therefore cannot sign in at all; their credentials are posted to the primary DB and rejected. `POST mode=resolve` has the same session requirement (`route.ts:121-131`).

Concrete scenario: provision tenant B on 8093; `ownerB@shop.in` opens `/login`; the browser never learns `:8093`; `authWithPassword` runs against 8090 and fails with "Failed to authenticate".

**Evidence**

- Full read of `src/app/api/system/tenant-db/route.ts`, `src/lib/pocketbase.ts`, `src/contexts/AuthContext.tsx`.
- `authenticateOperator` (`src/lib/api-auth.ts:50-55`) rejects a missing token before resolving anything.
- Single-account mode returns early (`route.ts:65-67`) and never hits the session check, which is why the shipped deployment is unaffected.

**Minimal fix**

Return `{ success: true, pbUrl }` for a registered tenant without a session (URL only, no existence/port/slug inventory), or add a dedicated pre-login resolver that does exactly that.

**Confidence:** confirmed (multi-account only).

---

### T-08 [MEDIUM] Tenant-db GET wakes/registers a tenant database before authenticating — `src/app/api/system/tenant-db/route.ts:73`

**What the code does**

```ts
const emailParam = (req.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
const registry = readTenantRegistry();
const targetEmail = emailParam || registry.activeTenantEmail;

const resolved = await resolveTenantDatabase(targetEmail, { activate: false });

const session = await authenticateOperator(req, targetEmail);
```

`resolveTenantDatabase` starts the tenant's PocketBase process as a side effect:

```ts
// src/lib/tenant-db-manager.ts:594
if (record && record.tenantSlug !== 'primary') {
    await ensureTenantPocketBaseRunning(record.port, record.dataDir);
    ...
}
```

and for an email with no registry row but an on-disk `data.db`, it allocates a port and adds an in-memory registry entry (`tenant-db-manager.ts:582-591`).

**Why wrong**

Expected: authentication precedes any operation on a tenant database.

Actual: an unauthenticated `GET /api/system/tenant-db?email=<any registered email>` runs `ensureTenantPocketBaseRunning`, spawning a detached PocketBase process for that tenant (loopback bind, but CPU/RAM/port consumed), before the 401 is returned. Repeating it across emails (or the unregistered-on-disk case) is an unauthenticated resource-exhaustion vector. The caller learns nothing (the response is 401), but the side effect has already happened. Multi-account only; single mode returns before `resolveTenantDatabase` (`route.ts:65-67`).

**Evidence**

- Full read of `route.ts`, `tenant-db-manager.ts`.
- `ensureTenantPocketBaseRunning` spawns with `detached: true` and polls up to 8 s (`tenant-db-manager.ts:300-350`), so the work is real and repeatable.
- No rate limit on the GET path (the limiter is only used on the dead provisioning branch, `route.ts:133`).

**Minimal fix**

Authenticate first (`const session = await authenticateOperator(...)`) and only then call `resolveTenantDatabase`.

**Confidence:** confirmed (multi-account only).

---

### T-09 [MEDIUM] E-way Bill settings update always sends `account_email`, which the tenant body guard rejects — `src/app/api/settings/eway/route.ts:198`

**What the code does**

```ts
if (existing) {
    await session.client.collection('store_settings').update(existing.id, {
        ...payload,
        // Always stamp the caller's tenant (audit L-01): preserving a
        // legacy empty owner kept the row globally readable forever.
        account_email: tenant,
    });
} else {
    await session.client.collection('store_settings').create(payload);
}
```

`payload` already contains `account_email: tenant` (`route.ts:187-196`), and `session.client` is authenticated with the **operator's** token, not a superuser (`api-auth.ts:72-79`).

**Why wrong**

Expected: an administrator with `settings:update` can save E-way Bill credentials.

Actual: the `store_settings` update rule ends with `@request.body.account_email:isset = false` (`1793003100_tenant_update_guards_and_otp_seal.js:129-131`), so every update that includes the key is denied. PocketBase reports rule-denied updates as 404 (the codebase relies on exactly that in `settings.ts:268-273`), the route has no catch around this update, and Next returns 500. The first save (create) succeeds because `createRule` permits a body `account_email` equal to the caller's tenant; every subsequent save fails.

Concrete scenario: an admin enters the E-way client id/secret, saves (200), edits the username and saves again → 500 "Failed to save E-way Bill settings".

**Evidence**

- Full read of `src/app/api/settings/eway/route.ts`, `src/lib/api-auth.ts`.
- Rule trace: `store_settings` in `1793001500_tenant_rules_dual_identity.js:58-77`, guard appended by `1793003100_tenant_update_guards_and_otp_seal.js:111-137`.
- The same pattern exists in `src/app/api/storefront/content/route.ts:448-453` (another cluster), which also sends `account_email` on update, so the guard has a second victim there.

**Minimal fix**

Drop `account_email` from the update payload; keep it only in the create payload (`...payload` already carries it there).

**Confidence:** confirmed by rule semantics; needs-runtime-check only for the exact status code surfaced by Next.

---

### T-10 [LOW] Tenant-db POST "provisioning disabled" gate is bypassed by any non-exact-case `mode` — `src/app/api/system/tenant-db/route.ts:101`

**What the code does**

```ts
const mode: 'provision' | 'resolve' = body.mode || 'resolve';

if (mode === 'provision') {
    return NextResponse.json(
        { success: false, error: 'Dynamic web provisioning is disabled. Use server-side CLI bootstrap.' },
        { status: 403 }
    );
}
...
if (mode === 'resolve') { ...return... }

if (rateLimited(req)) ...
const provisioned = await provisionTenantDatabase({ email, password, ... });
```

**Why wrong**

Expected: provisioning is disabled, so no input reaches `provisionTenantDatabase`.

Actual: `"Provision"`, `"PROVISION"`, `" provision"` (and any other string) skip both early returns and fall through to the provisioning path in multi-account mode. The later guards still apply (valid session for an existing account, or `x-setup-token` for a new one), but the explicit feature lock is void. For an existing account the session check accepts **any** staff member of that tenant (`tenantAccessAllowed(session.email, ...)` compares the owner email, which staff inherit), and provisioning runs `superuser upsert <email> <new password>` (`tenant-db-manager.ts:282-294`), resetting the tenant DB superuser password. A staff account on the same host can then authenticate directly against the loopback PocketBase as superuser and bypass every tenant rule.

**Evidence**

- Full read of `route.ts`; `tenant-db-manager.ts:381-523` (provisioning path) and `:282-294` (password upsert).
- Single-account mode returns the primary URL before this branch (`route.ts:111-113`), so this is multi-account only.
- `api-auth.tenantAccessAllowed` (`api-auth.ts:40-48`) compares `session.email` (the owner `account_email`) to the target, so staff pass.

**Minimal fix**

Normalize before comparing: `const mode = String(body.mode || 'resolve').trim().toLowerCase();` and reject any value other than `resolve` (or keep provisioning behind an explicit server-only flag).

**Confidence:** likely (multi-account only; requires the caller to reach the tenant's loopback PocketBase to use the reset superuser password, or to rely on the Next server's registry now holding it).

---

### T-11 [LOW] Tenancy guards fail open on records with an empty `account_email` — `src/lib/customers.ts:127`

**What the code does**

Four separate guards treat "no owner" as "mine":

```ts
// src/lib/customers.ts:125-128
const record = await pb.collection('customers').getOne<Customer>(id);
const tenant = accountScopeEmail();
if (tenant && record.account_email && record.account_email !== tenant) return null;
return record;
```

```ts
// src/lib/customers.ts:186-189 (assertCustomerOwnership)
if (tenant && record.account_email && record.account_email !== tenant) {
    throw new Error('Customer not found');
}
```

```ts
// src/lib/customer-lookup.ts:314-321
function canActOnCustomerRecord(record?: ...): boolean {
    if (!record) return false;
    const scope = accountScopeEmail();
    if (!scope) return true;            // fail open with no session
    const recEmail = ...(record as Record<string, unknown>).account_email;
    if (!recEmail) return true;         // fail open on unowned rows
    return String(recEmail).trim().toLowerCase() === scope.trim().toLowerCase();
}
```

```ts
// src/lib/register.ts:170-172
const tenant = accountScopeEmail();
const owner = (record as ...).account_email;
if (tenant && owner && owner !== tenant) return null;
```

**Why wrong**

The codebase's own rule is that a record with no owner is nobody's in multi-account mode and belongs to the single account in single mode (`canActOnTenant`, `pocketbase.ts:228-235`). These guards instead return the record when `owner` is empty (or when the caller has no scope). The PocketBase rules currently backstop client-side calls: `customers` view/update require `account_email = auth.email|auth.account_email`, so an empty-owner row is denied to a real user token. The guards are therefore latent today, but they are the only check in these functions, and any future superuser/server-side use (or a rule regression) turns them into a cross-tenant read/write. This is exactly the "permission check that fails open on a malformed record" class.

**Evidence**

- Full read of `src/lib/customers.ts`, `src/lib/customer-lookup.ts`, `src/lib/register.ts`.
- `pocketbase.ts:228-235` shows the intended rule; these guards do not call it.
- Callers: customer detail page (`getCustomer`, `updateCustomer`, `deleteCustomer`), WhatsApp chat linking (`updateCustomerNotes`, `addCustomerTag`, `setCustomerLeadStatus`, `updateCustomerCRMProfile`), POS shift close (`getShift`).
- Current backstop: `1793001500_tenant_rules_dual_identity.js:58-77` (customers) and `1793003100` (body guard).

**Minimal fix**

Replace the three ad-hoc comparisons with `if (!canActOnTenant(record.account_email)) return null;` (and `canActOnCustomerRecord`'s empty-owner branch with the same), which already treats empty as single-account-owned only.

**Confidence:** confirmed (code); exploitability today blocked by the tenant rules, so needs-runtime-check only if called with a superuser client.

---

### T-12 [LOW] Inventory template route verifies tokens against the primary DB in multi-account mode — `src/app/api/inventory/template/route.ts:11`

**What the code does**

```ts
const session = await authenticateOperator(req);
if (!session.ok) { ...401... }
const client = await createTenantClient(session.email);
```

`authenticateOperator(req)` with no hint resolves the **primary** database in multi-account mode (`api-auth.ts:59-62`: `isSingleAccountMode() ? '' : (hintEmail || '')`, then `resolveTenantDatabase(undefined)` -> primary fallback). A user whose account lives only in a dedicated tenant database can never verify the token, so the route always 401s for them. The route has no other hint mechanism (unlike `ai/http.ts`'s `x-tenant-email` and the eway route's `accountEmail` body field).

**Why wrong**

Expected: an authenticated tenant operator can download the inventory import template.

Actual: in multi-account mode only users of the primary database can use the route; dedicated-tenant users cannot. Single-account mode is unaffected. This is a functional gap rather than a data exposure, and it is the same root cause as T-07 (no pre-auth tenant hint).

**Evidence**

- Full read of `src/app/api/inventory/template/route.ts`, `src/lib/api-auth.ts`, `src/lib/pocketbase.ts`.
- Caller grep: the template endpoint is called from the inventory import UI with the bearer token only.

**Minimal fix**

Pass the caller's tenant through the same hint channel the other routes use (`x-tenant-email`) and verify against it, or resolve the tenant from the token after a primary-DB probe only when the user exists there.

**Confidence:** confirmed (multi-account only).

---

## Checked and clean

Files read in full (or, where noted, every logic-bearing region):

- `src/lib/pocketbase.ts`, `pocketbase-url.ts`, `tenant-db-manager.ts`, `tenant-secrets.ts`, `storefront-tenant.ts`, `single-account-bootstrap.ts`, `deployment-mode.ts`, `host-guard.ts`, `api-auth.ts`, `rbac.ts`, `rate-limit.ts`, `otp-store.ts`, `customer-token.ts`, `settings.ts`, `app-users.ts`, `register.ts`, `setup.ts`, `storefront.ts`, `public-surfaces.ts`, `customer-lookup.ts`, `customers.ts`
- `src/app/api/ai/chat/route.ts`, `ai/status/route.ts`, `ai/providers/route.ts`, `ai/providers/models/route.ts`, `ai/providers/test/route.ts`, `ai/conversations/route.ts`, `ai/conversations/[id]/route.ts`
- `src/app/api/analytics/turnover/route.ts`, `api/setup/status/route.ts`, `api/settings/eway/route.ts`, `api/system/tenant-db/route.ts`, `api/inventory/template/route.ts`, `api/tracking/st-courier/route.ts`
- `src/app/login/page.tsx`, `login/layout.tsx`, `setup/page.tsx`, `setup/layout.tsx`, `users/page.tsx`, `settings/page.tsx`
- `src/app/customers/page.tsx` (logic regions: 140-540, 772-796; remainder is presentational JSX scanned by grep) and `src/app/customers/detail/page.tsx` (1-330; remainder presentational)
- Auth shell: `src/proxy.ts`, `src/contexts/AuthContext.tsx`, `src/components/auth/AuthGate.tsx`, `src/components/auth/ProtectedRoute.tsx`, `src/hooks/usePermissions.ts`, `src/instrumentation.ts`
- Rules read: `1793001500_tenant_rules_dual_identity.js`, `1793003100_tenant_update_guards_and_otp_seal.js`, `1793001300_roles_tenant_scope.js`, `1792800000_users_tenant_scoping.js`, `1793000002_tenant_owner_rules_and_rbac_hardening.js`, `1793003200_rbac_data_plane_delete_guards.js`, `1792774206_store_settings_rules.js`, `1793001200_otp_codes.js`, `1792410187_updated_loyalty_accounts.js`, `1792415991_updated_loyalty_settings.js`, `1792410187_updated_discounts.js` (rules)
- Test scripts for intent/gaps: `src/scripts/test-tenant-auth.ts`, `test-tenant-runtime.ts`, `test-tenant-secrets.ts`, `test-rate-limit.ts`, `test-customer-token.ts`

Behaviours verified correct (not reported as defects):

- **OTP binding/reuse/expiry** (`otp-store.ts`): rows are keyed `(account_email, phone)` with a unique index; hash is `HMAC(pepper, phone:otp)`; 5-minute TTL; a successful verify clears the code; attempt accounting is an atomic `attempts+` with a 5-guess cap; daily counter is atomically reserved; the row is not readable/writable by tenant tokens after `1793003100` (superuser-only).
- **Customer token** (`customer-token.ts`): HMAC-SHA256 over the payload, missing secret fails closed, required `exp` with a 10-year cap, tenant/id/phone bound; `delete-customer` re-checks the record's tenant and refuses a body `customerId` that differs from the token id; order confirmation re-checks tenant and phone.
- **RBAC self-escalation**: `user_roles` create/update/delete require a `user_roles:auth` row that is the caller's and is named Admin (`1793000002:30-33`, `1793001300:36-45`), so `setUserRoles`/`assignRole` cannot self-assign; role names "Admin"/"Super Admin" are reserved in `createRole`/`updateRole`; `isSystemAdminRole` rejects `is_system === false`.
- **Operator auth** (`api-auth.ts`): token is re-verified with `authRefresh` against the resolved DB, the hint is compared to the token record's `account_email`, missing session/tenant/role fails closed, and capability lookup is tenant-scoped and errors to `false`.
- **AI routes**: tenant scope comes from the verified session, never the body; provider public projections omit `api_key`; provider config routes require `settings:update`; conversations/events are filtered by `account_email` and `created_by`; approvals are matched against the actual pending tool calls (`agent-loop.ts:139-143,295-319`); provider errors are redacted.
- **Public catalog feed** (`api/catalog/feed`): requires `CATALOG_SYNC_KEY` (constant-time) or an operator session whose tenant matches the requested account before `createTenantClient`.
- **Setup**: `/setup` redirects in single mode (`setup/layout.tsx:16-18`), the page redirects in all modes, `/api/setup/status` is a static `{complete:true}`, and module-level setup provisioning helpers have no callers — no re-runnable setup/register hijack path exists.
- **Login**: `safeNextPath` rejects protocol-relative, backslash, encoded and `/setup` targets; no `_superusers` fallback on the app login (`AuthContext.tsx:134-151`); inactive accounts are cleared.
- **Host guard**: canonical path decoding, traversal/backslash refusal, `/api/*` excluded from the static-extension allowance, unknown hosts treated as storefront, loopback trusted only when no forwarding headers are present (`proxy.ts:31-35`).
- **Deployment mode**: `assertDeploymentModeConsistent` fails closed in `createTenantClient`/`ensureServerAuth`; browser and server values are separated.
- **Secret encryption** (`tenant-secrets.ts`): AES-256-GCM with a fresh IV and auth tag; key parsing accepts only 64 hex characters; tamper/wrong-key detection tested; the production plaintext policy is correct for registry rows (its misapplication to env credentials is T-03).
- **Rate limiter mechanics** (`rate-limit.ts`): fixed-window reset, per-key isolation, pruning and the key-count cap are correct; the tested `x-forwarded-for` right-most selection is correct when `TRUSTED_PROXY_HOPS` is set; only the unconditional header trust is reported (T-06).
