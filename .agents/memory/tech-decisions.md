---
type: project
created: 2026-07-18
updated: 2026-10-30
---

# Technical Decisions

- Component metadata uses SemVer while the toolkit release keeps CalVer.
- `manifest.json` and `manifest.lock.json` must remain synchronized with component frontmatter.

## Quick Add Series Memory (2026-10-30)

- The Quick Add dialog (`QuickAddProductDialog`) is the single rapid piece-by-piece entry path and runs the full SKU taxonomy engine (`sku-generator.ts`); the full Add Product dialog keeps its own SKU Architect untouched.
- Series identity for the memory stack (`quick-add-memory.ts`) deliberately EXCLUDES the colour code — colour is the per-piece level, so a colour-run upserts one series entry instead of stacking chips. Entries also carry commercial fields (cost, channel overrides, HSN, location, stock, craft/plating/occasion/base metal).
- Memory persists to PocketBase `store_settings` key `quick_add_memory` (category `quick_add`, `account_email`-scoped) with a tenant-scoped localStorage cache (`luminila_quick_add_memory_v1_<email>`) hydrated synchronously at module init — same hybrid pattern as `jewelry_sku_taxonomies`.
- "Clone a piece" recovers taxonomy codes by parsing architecture SKUs (`TMPNECCHK04821-MGRBSTD-C12` → genre/cat/subcat/plating/colour/size/packaging); non-architecture SKUs fall back to category-label matching.
- Keyboard: `Alt+N` opens Quick add (`use-inventory-shortcuts.ts`); inside the dialog `Enter` = save & add another, `Ctrl/Cmd+Enter` = save draft & close.
