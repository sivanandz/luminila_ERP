# Proposed migration bundle (draft, not applied)

These files are a **review draft**. They are deliberately outside
`pocketbase/pb_migrations` so that starting PocketBase does not apply them
before you approve.

Nothing here has been run. `pocketbase/pb_data` and
`pb_tenants/registry.json` are untouched.

## What is proposed

| File | Creates or changes | Unblocks |
|---|---|---|
| `001_manufacturing_jobs.js` | New `manufacturing_jobs` collection | Karigar job cards move out of the `store_settings` JSON blob |
| `002_cheques.js` | New `cheques` collection with a unique tenant cheque index | Cheque register becomes a real ledger; duplicate cheque numbers are refused |
| `003_products_craft_and_gst_rate.js` | `products.craft`, `plating`, `occasion`, `base_metal`, `gst_rate` | Imitation taxonomy persists; D-14 can read a real product rate |
| `004_landed_cost_and_channels.js` | `purchase_orders.overhead_amount`, `purchase_order_items.landed_unit_cost`, `sales.channel`, `whatsapp_campaigns`, `sales.campaign` | D-13 concurrency fix, channel enum, campaign attribution |
| `005_indexes.js` | Unique index on `invoices.order`; reporting indexes | D-20 hardening and faster report queries |
| `006_store_settings_rules.js` | Tenant-scoped collection rules on `store_settings` (audit 2026-10-22, #8) | Authenticated users can no longer read or write another tenant's settings rows in a shared instance; legacy rows with an empty `account_email` stay readable |

## How to apply, when you approve

1. **Back up first.** Use `/backup` and keep the JSON file outside this machine.
2. **Check for duplicate invoice orders.** The unique index will fail if two
   invoices already share an `order` value. Run this in the PocketBase admin UI
   or console and resolve anything it returns before applying:
   `SELECT "order", COUNT(*) FROM invoices WHERE "order" != '' GROUP BY "order" HAVING COUNT(*) > 1;`
3. Copy the files into `pocketbase/pb_migrations/`, keeping the numeric order,
   then restart PocketBase. Each file has an `up` and a `down`.
4. Verify: open two manufacturing jobs, register a cheque, set a product GST
   rate, and confirm the stock report still loads.

## Rollback

Every migration implements a `down` that removes exactly what its `up` added.
Running them in reverse order restores the previous schema. **Data written into
the new columns or collections is lost on rollback**, so export first.

## What is deliberately not included

- The six phantom collections from D-36 (`inventory_locations`,
  `inventory_transfers`, `catalog_sync_logs`, `shipments`, `cash_registers`).
  Their engines are still unwired; creating empty tables first would repeat the
  original defect of schema without behaviour.
- Tenant registry encryption (S-06). That is a re-key operation, not a schema
  addition, and needs its own plan.
- A weighted-average cost history table. The reporting slice uses the newest
  landed cost until this bundle lands; a history table is the follow-up.

## Risk notes

- `004` adds a relation from `sales` to `whatsapp_campaigns`. Existing sales get
  an empty relation, which is valid.
- `003` leaves `gst_rate` empty on existing products. The POS falls back to the
  category rate, so behaviour does not change until rates are filled in.
- `005` changes write behaviour for `invoices.order`: a duplicate becomes a
  visible error instead of silent corruption. That is the intent.
- These drafts were syntax-checked but **not executed**. Before applying, run
  them once against a copy of `pb_data` (duplicate the folder, start a second
  PocketBase on another port, then inspect the schema).
