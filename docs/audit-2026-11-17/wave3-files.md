# Wave 3 — Backup / Import / Export / SKU / Activity

**Date:** 2026-11-17
**Project:** E:\Local_GIT_2\luminila_inv_mgmt (Next.js 16 + TypeScript + PocketBase)
**Mode:** REPORT ONLY — no application code was modified.

## Scope

Read completely (9 mandated files):

1. `src/lib/backup.ts`
2. `src/lib/database-snapshot.ts`
3. `src/lib/excel-import.ts`
4. `src/lib/csv.ts`
5. `src/lib/sku-generator.ts`
6. `src/lib/quick-add-memory.ts`
7. `src/lib/image-matcher.ts`
8. `src/app/backup/page.tsx`
9. `src/app/activity/page.tsx`

Extra files opened (budget: 3, used 2):

- `src/lib/activity.ts` — read in full, only to prove the activity-log actor claims (B-12, B-18, B-19, B-20).
- `src/lib/pocketbase.ts` — targeted grep only (tenant helper bodies), only to prove B-21 and B-24.

Looked for: unguarded restore/import that wipes or duplicates; half-applied imports; exports missing money/tax data; parsing that accepts bad rows, skips rows silently or maps by position; SKU collisions; snapshots omitting money/stock collections; forgeable activity entries that drop the actor.

## Counts

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 10 |
| Medium | 9 |
| Low | 4 |
| **Total** | **25** |

---

## Critical

### B-01 [CRITICAL] Bulk inventory import has no dedupe — re-uploading duplicates products and double-counts stock — src/lib/excel-import.ts:798
**What the code does:** every valid row unconditionally creates a new product, a new variant and a new restock movement. There is no lookup by SKU, no file hash, no "already imported" marker.

```ts
const product = await pbClient.collection('products').create({
    account_email: accountEmail,
    name: item.name,
    sku: finalSku, ...
```
(line 798; variant at 816; stock movement at 840)

**Why wrong:** `finalSku` is taken verbatim from the sheet (`item.sku.trim()`), so importing the same sheet twice produces two products with the same SKU, two `product_variants` with `stock_level` = the sheet quantity, and two `stock_movements` of `+N`. Re-importing a 100-piece sheet doubles on-hand stock and inventory valuation, and the user has no signal that anything was duplicated (the result only reports `successCount`). A corrected re-upload after a partial failure (see B-03) does the same thing.
**Evidence:** no existence check on `products.sku` anywhere in `commitBulkInventoryImport` (lines 769–873); `stock_movements` is created with `movement_type: 'restock'` at 846; the only key used for lookup is `rowNumber` in local maps.
**Fix:** before create, `getFirstListItem('sku="..." && account_email="..."')`; skip (or update) when found, and count it as `skipped`.
**Confidence:** confirmed.

### B-02 [CRITICAL] The official template ships 5 sample rows that import as real products and stock — src/lib/excel-import.ts:126
**What the code does:** `generateInventoryImportTemplateWorkbook()` writes five fully populated data rows into the Products sheet:

```ts
name: '22K Gold Temple Haram (Lakshmi Motif)',
sku: 'TMP-HAR-001',
category: 'Harams (Long Chains)',
base_price: 185000,
cost_price: 165000,
stock: 3,
```
(lines 126–207), and the Instructions sheet (236–255) never tells the user to delete them.

**Why wrong:** the template is the documented upload path, and the parser reads every row after the header. A user who downloads the template, appends their own pieces and uploads gets five phantom products (₹185,000 / ₹34,500 / ₹95,000 / ₹12,500 / ₹128,000) with stock +3/+8/+5/+12/+4 and five `stock_movements`, all counted as a successful import. Two of the five have `sku: ''` and therefore also get machine-generated SKUs, so they cannot even be recognised as samples afterwards.
**Evidence:** `sampleRows.forEach(row => { const addedRow = dataSheet.addRow(row); ... })` (209–221); `parseInventoryImportFile` has no sample/example filtering (541–664); instruction list contains no "remove the sample rows" entry (236–255).
**Fix:** emit the samples into a separate "Examples" sheet (or prefix names with `EXAMPLE -`) and skip `EXAMPLE`-prefixed rows in the parser.
**Confidence:** confirmed.

---

## High

### B-03 [HIGH] Import is not atomic — a failed variant/stock write leaves an orphan product that the retry then duplicates — src/lib/excel-import.ts:798
**What the code does:** one row = three sequential creates inside a single `try`, and the stock movement failure is swallowed:

```ts
const product = await pbClient.collection('products').create({...});   // 798
const variant = await pbClient.collection('product_variants').create({...}); // 816
if (item.stock > 0) {
    await pbClient.collection('stock_movements').create({...})
        .catch(err => console.warn('Could not log initial stock movement:', err)); // 848
}
} catch (err: unknown) { failureCount++; ... }                          // 865
```
**Why wrong:** if the variant create fails (validation, quota, network), the product already exists but is reported as a failed row. The variant is what carries `stock_level`, so the product shows in inventory with zero stock and no movement; the user retries the row and now has two products (B-01). Conversely if `stock_movements` fails, the import reports success while the opening stock has no ledger entry — the variant says 12 units, the stock ledger has nothing, and any stock reconciliation disagrees with inventory.
**Evidence:** no compensating delete/rollback in the catch (865–872); the movement error is `.catch(warn)` at 848 while `successCount++` still runs at 864.
**Fix:** create the movement before returning success and treat its failure as a row failure; delete the product (or use a single PB transaction endpoint) when the variant create fails.
**Confidence:** confirmed.

### B-04 [HIGH] Price column resolves to "Cost Price" when no selling-price column exists — every imported item sells at cost — src/lib/excel-import.ts:519
**What the code does:** the header resolver does an exact pass, then a substring pass over the keywords in order:

```ts
const getColIndex = (keywords: string[]): number | undefined => {
    const exact = headers.find(h => keywords.includes(h.normalized));
    if (exact) return exact.index;
    for (const kw of keywords) {
        const found = headers.find(h => h.normalized.includes(kw));
        if (found) return found.index;
    }
```
(506–514), with

```ts
const priceCol = getColIndex(['sellingprice', 'baseprice', 'price', 'mrp', 'rate']); // 519
const costCol  = getColIndex(['costprice', 'cost', 'purchaseprice']);                // 520
```
**Why wrong:** for headers `Product Name, SKU, Category, Cost Price, Stock` (a very natural user sheet), the exact pass fails, then `'price'` substring-matches `costprice`. `priceCol` and `costCol` are then the *same* column, `base_price = cost price`, and validation passes because cost > 0. Every piece is priced at cost; margin is zero and nothing is reported. The same substring pass lets `'stock'` claim `Low Stock Threshold` (521) — stock becomes the threshold value (typically 2) — and lets `'po'` claim any header containing "po" (530).
**Evidence:** `normalizeHeader` strips `*()₹`, spaces and `_` only (383–388), so "Cost Price (₹)" normalizes to exactly `costprice`.
**Fix:** require an exact match for the money columns; if no selling-price header exists, throw instead of falling back.
**Confidence:** confirmed.

### B-05 [HIGH] Backup omits `categories`, so a disaster restore leaves every product with a dangling category — src/lib/backup.ts:61
**What the code does:** `BACKUP_TABLES` is the single list used for both export and restore, and it has no `categories` entry (61–93). Products, however, store a relation to it:

```ts
const newCat = await pbClient.collection('categories').create({ name: normalizedCatName, is_active: true });
...
const product = await pbClient.collection('products').create({ ..., category: categoryId, ... });
```
(`excel-import.ts` 779–785, 798–813)

**Why wrong:** the restore loop only iterates `BACKUP_TABLES` (294–295). Restoring into a fresh database (the stated disaster-recovery use) creates products whose `category` field points at ids that were never restored — no error, because PocketBase resolves relations lazily. The catalog comes back with every product uncategorised, which breaks category reporting and any category-driven HSN/GST defaulting. `store_settings` and `users` are likewise absent, so staff-referenced fields and settings (SKU taxonomies, import template, tax configuration) are also lost, while `expense_categories` *was* included — showing the omission is accidental.
**Evidence:** `BACKUP_TABLES` listing 61–93 (grep `categories`: only `expense_categories`); `BackupData.tables` interface 18–50 also has no `categories`.
**Fix:** insert `"categories"` before `"products"` in `BACKUP_TABLES` and add it to `BackupData.tables`.
**Confidence:** confirmed.

### B-06 [HIGH] Restore half-applies and the rollback snapshot is thrown away by the UI — src/lib/backup.ts:281
**What the code does:** the restore writes row-by-row with no transaction, aborts only on update/lookup failures, keeps going on create failures, and returns a snapshot "for manual rollback":

```ts
const snapshot = await createBackup();
...
} catch (error) {
    stats.failed += 1;
    recordError(table, id, error);   // create failure: no abort, continues
}
...
return { success: ..., snapshot, ... };
```
(281–291, 385–391, 413–423)

**Why wrong:** two distinct problems.

1. A create failure is *not* an abort (only the update/lookup/ownership paths set `aborted`), so a restore can write invoices and then fail on `invoice_items`, leaving header rows with no lines and a `success: false` result while the partial data stays live.
2. The only rollback artifact (`snapshot`, a full in-memory `BackupData`) is returned to `backup/page.tsx`, stored with `setResult(response)` (backup/page.tsx:122) and **never rendered, downloaded or persisted** — the result block only prints `message`, `restored`, `tables` and `errors` (329–378). A page reload after a failed restore loses the only copy of the pre-restore state.

`restoreFromBackup` also contains no function that *applies* a snapshot, so "manual rollback" is not actually supported by the codebase.
**Evidence:** `if (aborted) break;` only after `stats` (398); no `aborted = true` in the create catch (388–391); no `snapshot` reference in backup/page.tsx.
**Fix:** treat create failure as abort, and write the snapshot to a download (`downloadAsFile(JSON.stringify(snapshot), 'pre-restore.json')`) before the first write.
**Confidence:** confirmed.

### B-07 [HIGH] "Automatic snapshot" stores no data — "Restore last snapshot" can never succeed — src/lib/backup.ts:458
**What the code does:** the scheduled backup deliberately deletes the auto-backup key and stores only a timestamp:

```ts
const persist = (_backup: BackupData) => {
    ...
    localStorage.removeItem(keys.autoBackup);
    localStorage.setItem(keys.lastBackup, new Date().toISOString());
```
(458–468), while the restore path reads the key that is never written:

```ts
const backupData = localStorage.getItem(getBackupStorageKeys().autoBackup);
if (!backupData) return false;
```
(511–515)

**Why wrong:** the feature is dead end-to-end but the UI advertises the opposite. `backup/page.tsx` tells the user "a full snapshot is written to this browser's local storage just after midnight and kept until replaced" (222–224) and enables the button from the *timestamp* alone (`disabled={!lastAuto}`, 232–234). So after a data-loss event the owner clicks "Restore last snapshot" and always gets "No usable automatic backup found" (137) — the one recovery path the screen promises does not exist.
**Evidence:** `removeItem(keys.autoBackup)` at 463 with no `setItem` for that key anywhere in the file; `restoreFromAutoBackup` returns `false` when the key is absent (515).
**Fix:** either persist a real (encrypted, size-capped) snapshot to IndexedDB and point `restoreFromAutoBackup` at it, or remove the auto-restore button and the "written to local storage" copy.
**Confidence:** confirmed.

### B-08 [HIGH] The "full database snapshot" export omits payments, sales and the stock ledger — src/lib/database-snapshot.ts:23
**What the code does:** `DatabaseSnapshot.data` and the query list contain exactly six collections:

```ts
data: {
    products: unknown[]; product_variants: unknown[];
    customers: unknown[]; invoices: unknown[]; invoice_items: unknown[]; store_settings: unknown[];
};
```
(23–31; queried at 101–108; returned at 134–141), with a header comment calling it "Full database snapshot for the Settings → Export screen" (1–7).

**Why wrong:** an export handed to an accountant or used for recovery contains invoices and their lines but **not `invoice_payments`** (money actually received), **not `sales`/`sale_items`** (POS revenue), **not `stock_movements`** (the only record from which on-hand stock can be reconstructed), and not `vendors`, `purchase_orders` or `expenses`. Outstanding balances, cash reconciliation and stock valuation cannot be produced from it, yet the payload is versioned `2.1.0` and presented as a database export. `summary` reinforces the false impression by counting only five tables (127–133).
**Evidence:** interface 11–31; `Promise.all` list 101–108; the sibling `BACKUP_TABLES` in backup.ts holds 30 tables, 24 of which are missing here.
**Fix:** derive the export list from `BACKUP_TABLES` (or rename the feature "product & invoice export" and drop the summary claims).
**Confidence:** confirmed.

### B-09 [HIGH] Import auto-SKU has only 900 distinct values per 16-minute window and bypasses the race-safe allocator — src/lib/excel-import.ts:791
**What the code does:**

```ts
const finalSku = item.sku && item.sku.trim().length > 0
    ? item.sku.trim()
    : `SKU-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
```

**Why wrong:** `Date.now().toString().slice(-6)` repeats every 1,000,000 ms ≈ 16.7 minutes, and the random part has 900 values. For a fixed window the birthday bound gives a collision probability of ~58% at 40 blank-SKU rows in one import — and the template explicitly invites blank SKUs ("If left blank, Luminila automatically generates one", 238). Duplicate SKUs are never rejected (B-01), so two different pieces end up with identical SKUs, which breaks barcode scanning and `computeNextSkuSequence`, whose `^PREFIX(\d{5})` regex cannot even parse this format so it will hand out `SKU…` numbers independently.
**Evidence:** the project already has a correct allocator (`computeNextSkuSequence`, sku-generator.ts:403–447) with tenant scoping and re-read; this path does not call it.
**Fix:** call `computeNextSkuSequence` (or `generateParentSKU`) for blank SKUs and persist the result.
**Confidence:** confirmed.

### B-10 [HIGH] Category lookup is unscoped and new categories are created without `account_email` — src/lib/excel-import.ts:701
**What the code does:**

```ts
const existingCats = await pbClient.collection('categories').getFullList().catch(() => []);
...
const newCat = await pbClient.collection('categories').create({
    name: normalizedCatName,
    is_active: true,
});
```
(701–706, 779–785)

**Why wrong:** every other query in this module is tenant-filtered (`poScope` 716, products/stock writes stamp `account_email`), but the category list has no `account_email` predicate and the category insert does not stamp one. Two consequences: (a) if the collection's list rule is permissive, tenant A's `catMap` resolves a name to tenant B's category id and A's products are linked to B's record; (b) the created category has an empty `account_email`, so it is invisible to the tenant-scoped category queries used everywhere else and the next import creates a duplicate category of the same name (which then also feeds the product relation), while any tenant whose view is unscoped can see A's category.
**Evidence:** contrast line 701 with 716 (`poScope`); contrast 779–782 with the product/variant inserts that all pass `account_email: accountEmail` (799, 817, 841).
**Fix:** add `account_email` to the filter and to the create payload; fail closed when `accountEmail` is empty.
**Confidence:** confirmed (defect); the cross-tenant reuse is conditional on the collection rule → needs-runtime-check for impact.

### B-11 [HIGH] CSV price parsing turns "1,290" into 1 and passes validation — src/lib/csv.ts:140
**What the code does:**

```ts
const price = parseFloat(row.base_price);
if (isNaN(price) || price <= 0) {
    errors.push(`Row ${rowIndex}: Invalid base price "${row.base_price}"`);
}
```
(140–143)

**Why wrong:** `parseFloat` stops at the first invalid character. A CSV exported from Excel with a thousands separator (`"Pearl Drop Earrings",…,"1,290",…` — quoted, so it survives `parseCSVLine` intact) yields `parseFloat("1,290") === 1`, which is `> 0` and therefore valid. Products are imported (or exported round-tripped) at ₹1 instead of ₹1,290. The same function accepts `"1290abc"` as 1290 and truncates `"12.5"` stock to 12 via `parseInt` (145–148).
**Evidence:** `validateProductRow` is the only price gate for `importProductsFromFile` (270–301).
**Fix:** reject any string containing `,`/non-numeric characters before parsing, e.g. `if (!/^\d+(\.\d+)?$/.test(row.base_price.trim())) error`.
**Confidence:** confirmed.

### B-12 [HIGH] Activity log actor name is supplied by the caller, not the session — src/app/activity/page.tsx:252 (mechanism: src/lib/activity.ts:147)
**What the code does:** the feed renders whatever `user_name` the record holds:

```tsx
{log.user_name && (
    <p className="text-xs text-muted-foreground mt-1">by {log.user_name}</p>
)}
```
(activity/page.tsx 252–256), and the writer takes it from an option that overrides the authenticated identity:

```ts
user_name: options?.userName || model?.name || '',
user_id: model?.id || '',
```
(activity.ts 147–183)

**Why wrong:** `logActivity` accepts an arbitrary `userName` and never compares it to `pb.authStore.model`, so any caller that passes `userName` (or replays a queued payload, B-20) writes an audit row attributed to a different employee while `user_id` points somewhere else — and the audit screen displays only `user_name`. Since the audit trail is the only attribution mechanism in the app, an entry like "Invoice deleted — by Priya" can be produced by any signed-in user without leaving a trace of the real actor unless someone reads `user_id` directly in PocketBase.
**Evidence:** writer 173–183; no server-side derivation of the name; the page never shows `user_id` (252–256).
**Fix:** drop the `userName` option and always derive `user_name` from the auth model (or render `user_name` only when it matches the `user_id` lookup).
**Confidence:** confirmed (mechanism); exploitable by any code path that passes `userName`.

---

## Medium

### B-13 [MEDIUM] Numeric coercion silently accepts malformed numbers — src/lib/excel-import.ts:590
```ts
const parsedStock = parseInt(String(rawStock ?? '0').replace(/[^0-9.-]+/g, ''), 10);
if (rawStock === undefined || isNaN(parsedStock) || parsedStock < 0) { ... }
```
(590–593; price uses the same strip-then-`parseFloat` at 584–587)

`"12.5"` → `12` (silently truncated, although the message says "must be an integer"), `"1e3"` → `"13"` → 13, `"1.234,56"` → `1.234`, `"S-100"` → `-100` (rejected, but for the wrong reason). Excel numeric cells with decimals (e.g. 0.5 g entered in the Stock column) import as 0. Validation should reject anything that is not a plain integer/decimal rather than dimensionless-stripping it.
**Fix:** test the raw string against `/^\d+$/` (stock) and `/^\d+(\.\d+)?$/` (money) before conversion.
**Confidence:** confirmed.

### B-14 [MEDIUM] Partially filled rows are dropped without an error and are not counted — src/lib/excel-import.ts:572
```ts
// Skip completely empty spacer rows
if (!rawName && !rawSku && rawPrice === undefined && rawStock === undefined) {
    continue;
}
```
(572–574) and `totalRows: validRows.length + invalidRows.length` (669).

A row where the user filled only `Cost Price`, `Gross Weight` or `Description` (no name/price/stock yet) is treated as an empty spacer: it produces no `invalidRows` entry, no error toast, and is excluded from `totalRows`, so the "N rows" figure shown to the user under-reports the file. The user believes the row was imported (or at least rejected) when it was silently discarded.
**Fix:** only `continue` when every mapped cell is empty; otherwise push a `RowValidationError` ("Purchase data without a product name").
**Confidence:** confirmed.

### B-15 [MEDIUM] `.xls` is advertised but the loader only reads `.xlsx` — src/lib/excel-import.ts:253
The Instructions sheet says `'Save and upload this file as .xlsx, .xls, or .csv. Headers must not be removed.'` (253), but any non-`.csv` buffer goes to ExcelJS's OOXML loader:

```ts
if (isCsv) { ... } else { await workbook.xlsx.load(buf); }
```
(462–465)

ExcelJS cannot parse BIFF8 `.xls`; a legacy workbook fails here with a raw library error and the user gets no actionable message, despite having been told the format is supported.
**Fix:** reject `.xls` with an explicit "save as .xlsx" message, or add a real BIFF reader.
**Confidence:** likely (code path confirmed; ExcelJS format support).

### B-16 [MEDIUM] Product CSV export drops HSN/tax and inventory report drops valuation — src/lib/csv.ts:171
`exportProductsToCSV` headers are SKU/Name/Category/Base Price/Cost Price/Variant/Material/Size/Color/Stock/Price Adjustment (171–183) — no `hsn_code`, no GST rate, no making charges, although imported products carry `hsn_code` (excel-import.ts:805) and HSN is what drives the 3% GST rate. `exportInventoryReport` exports only SKU/name/category/variant/stock/status (316) — a stock report with no cost or retail value, so it cannot be used for stock valuation or GST reconciliation.
**Fix:** append `HSN Code` (and cost/value) columns to both exports.
**Confidence:** confirmed.

### B-17 [MEDIUM] Restore accepts any file version and validates only six arrays — src/lib/backup.ts:259
```ts
if (data.version !== BACKUP_VERSION) {
    console.warn(`Backup version mismatch: ${data.version} vs ${BACKUP_VERSION}`);
}
```
(259–261) and `validateBackup` requires only `products, product_variants, vendors, sales, sale_items, stock_movements` to be arrays (166–185).

A file from an older/newer schema — or a hand-edited JSON with those six keys and `version: "9"` — proceeds to write every table present in the file, field by field, with no schema gate. Unknown fields and renamed fields are replayed into `create`/`update` and the outcome depends on PocketBase's field handling; failures surface only as per-row errors after earlier tables were already committed.
**Fix:** refuse on version mismatch (or keep a per-version field allowlist).
**Confidence:** likely.

### B-18 [MEDIUM] The activity feed shows no actor at all when the account has no display name — src/app/activity/page.tsx:252
`user_name` is written as `options?.userName || model?.name || ''` (activity.ts:181), so a PocketBase user provisioned with only an email produces entries with `user_name: ""`. The feed guards on `log.user_name` and therefore renders **nothing** for the actor — even though `user_id` is stored and available on the record (activity/page.tsx:252–256, `log.user_id` never referenced). Every action by such a user appears unattributed in the audit trail.
**Fix:** fall back to `log.user_id` (or the email) when `user_name` is empty.
**Confidence:** confirmed.

### B-19 [MEDIUM] A failed audit read renders as "No activity logs found" — src/app/activity/page.tsx:220
`getActivityLogs` swallows every error and returns an empty page (`catch { return { logs: [], total: 0 }; }`, activity.ts:137–140); `getActivityStats` does the same (279–286). The page's error `toast` only fires if the promise rejects (95–113), which it never does, and the empty state prints "No activity logs found" (220–224). A permissions regression, expired token or outage therefore presents the audit trail as cleanly empty rather than as unreadable — the worst possible failure mode for an audit screen.
**Fix:** return an `{ok:false, error}` result (as `database-snapshot.ts` does) and render an explicit "audit log unavailable" state.
**Confidence:** confirmed.

### B-20 [MEDIUM] Failed audit writes are parked in localStorage and replayed later, so entries can be forged and back-dated — src/lib/activity.ts:186
```ts
} catch (error) {
    console.warn('Activity log queued for replay:', error);
    try { OfflineQueue.enqueue('activity_logs', 'create', payload); } ...
}
```
(186–198)

The payload — including `description`, `user_name`, `user_id`, `created_at` intent and `account_email` — is written into browser storage, which the user can edit, and is written to `activity_logs` when connectivity returns. Two issues: an audit row can be injected by editing the queue, and because PocketBase stamps `created` at replay time, the entry's timestamp no longer reflects when the action happened (a back-dated or forward-dated audit event is impossible to detect from the log).
**Fix:** carry the original event time in a dedicated field and have the server reject client-supplied actor/`created`; do not queue audit writes from the client.
**Confidence:** likely (queue contents are client-side; replay path not read).

### B-21 [MEDIUM] Import stamps `account_email: "default"` when no session resolves — src/lib/excel-import.ts:696
```ts
const accountEmail = getCurrentTenantEmail() || (pbClient.authStore.model as { email?: string } | null)?.email || '';
```
(696)

`getCurrentTenantEmail()` never returns `''` — it returns the literal `"default"` when no model is present (`pocketbase.ts`: `... || "default"`). The `||` fallback is therefore dead, and an import started with an expired/absent session stamps every product, variant, category and movement with `account_email: "default"` instead of refusing. Those rows are invisible to the real tenant's scoped queries and land in one shared bucket across stores. Note this module never calls `accountScopeEmail()`/`ensureAuth()` even though every other module in this wave does (backup.ts:99, sku-generator.ts:411, activity.ts:84).
**Fix:** use `accountScopeEmail()` and abort the import with an explicit error when it is empty.
**Confidence:** confirmed.

---

## Low

### B-22 [LOW] Child-SKU length check does not match the generator (21 vs 22) — src/lib/sku-generator.ts:780
`generateChildSKU` returns `parent(14) + "-" + 6 = 21` characters (725–730), but `parseSKUType` classifies a child only at `parts.length === 2 && clean.length === 22` (780). No generated child SKU is ever recognised as `isChild`, so consumer logic keyed on that flag silently falls through to the "unknown" branch.
**Fix:** compare `clean.length === 21`.
**Confidence:** confirmed.

### B-23 [LOW] Sequence numbers above 99999 wrap and collide — src/lib/sku-generator.ts:716
`String(sequence || 1).padStart(5, "0").slice(-5)` silently truncates 100000 → `"00000"`, so the next allocated SKU reuses an existing style number (and `computeNextSkuSequence`'s `^PREFIX(\d{5})` regex reads a 6-digit sequence as its first five digits, compounding the drift).
**Fix:** throw when `sequence > 99999`.
**Confidence:** confirmed.

### B-24 [LOW] SKU taxonomy settings use an unscoped filter when the tenant is "default" — src/lib/sku-generator.ts:466
`loadSKUTaxonomies`/`saveSKUTaxonomies` fall back to `key="${PB_KEY}"` with no `account_email` predicate when the resolved tenant is `"default"` (466–469, 510–518). With a permissive rule, `getFirstListItem` can return another tenant's row and `update` then rewrites it; the in-memory taxonomy list can likewise be another store's.
**Fix:** fail closed (return defaults / throw) when the tenant is unresolved instead of dropping the predicate.
**Confidence:** likely (depends on the `store_settings` rules).

### B-25 [LOW] Rows with no `account_email` are adopted by whichever tenant restores — src/lib/backup.ts:316
```ts
const owner = String(row.account_email ?? "").trim().toLowerCase();
if (owner && owner !== tenantKey) { stats.skipped += 1; continue; }
...
row.account_email = tenant;
```
(316–325)

An owner-less row is not skipped; it is re-stamped with the restoring tenant. A pre-tenant (or hand-edited) backup belonging to store A can therefore be imported wholesale into store B — the exact cross-tenant import the rest of the function is written to prevent.
**Fix:** skip rows whose `account_email` is empty when `data.createdAt` predates the tenant-stamping release, or require an explicit "import legacy backup" confirmation.
**Confidence:** confirmed (behaviour); exploitable only with a legacy/edited file.

---

## Checked and found safe (negative results)

- **No wipe path.** `restoreFromBackup` never calls `delete`; rows absent from the file are left untouched (294–398). No "replace database" operation exists in these files.
- **Restore idempotency per id is guarded.** Existing rows are found with a tenant-scoped filter, looked up with `getOne` before create to refuse shadowing another tenant, and a non-404 lookup error aborts instead of falling through to create (327–383).
- **Negative quantity/price are rejected** in both importers (`excel-import.ts` 585–593, `csv.ts` 141–147).
- **Restore refuses to run without a resolvable tenant and without a complete pre-restore snapshot** (`backup.ts` 252–291).
- **`database-snapshot.ts` fails closed** on a missing tenant (`id = ""`) and on any collection read failure instead of exporting zero rows (99, 112–118).
- **CSV parsing is quote-aware** and rejects wrong column counts rather than shifting fields (`csv.ts` 34–64, 104–129).
- **CSV export neutralises formula injection** (`=`, `+`, `-`, `@`, including leading whitespace/control characters) — `csv.ts` 215–227.
- **Restore UI has a real confirmation gate** (checkbox + typed `RESTORE` + disabled button) — `backup/page.tsx` 300–326; the page is also admin/`settings:update` gated (167–183).

## Clean (read in full, nothing in the audited scope)

- `src/lib/image-matcher.ts` — tenant guard present (returns `[]` rather than matching across accounts, 102–108), matching is read-only, `image_url`/`image_data` both included. Nothing in scope (no import/export/backup/audit/SKU path).
- `src/lib/quick-add-memory.ts` — tenant-stamped singleton, defensive `sanitizeMemory`, colour excluded from the series key. Nothing in scope.

## Not scored (outside the requested classes, observed while reading)

- `quick-add-memory.ts` stores `stock` (and `costPrice`, `hsnCode`) in the series memory that is meant to be re-used for the *next* piece. If the quick-add dialog seeds a brand-new product's stock from it (caller not in this wave), consecutive pieces would inherit the previous piece's quantity. Needs the dialog's code to confirm.
- `image-matcher.ts` `storeProductImageHash` updates `products` by id with no tenant predicate (155); whether that is exploitable depends entirely on the collection rules.
