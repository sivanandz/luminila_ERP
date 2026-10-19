# Memory Index

## Project
- [project] Always create a new dedicated branch for major code changes → project-conventions.md
- [project] AG Kit only supports Gemini CLI and Google Antigravity (not other AI coding tools) → project-conventions.md
- [project] Component metadata uses SemVer while toolkit releases use CalVer → tech-decisions.md
- [ui-tabs] On narrow horizontal viewports, convert multi-tab bars into themed dropdowns instead of horizontal scrolls → project-conventions.md
- [message-templates] Never dispatch pre-generated or canned message templates directly; always provide direct editing, live sample previews, and pre-dispatch per-recipient customization → project-conventions.md
- [pocketbase] Auto-discovers ports 8090/8091 with cold-start bootstrap superuser for unified 1-step onboarding without external UI visits.
- [whatsapp] Vendor stock ingestion ("Add to Existing Inventory", "Create New Product", "Auto Barcode Tag") supports WhatsApp groups (...@g.us), communities, and channels (...@newsletter) with supplier attribution & media attachment.
- [whatsapp] Multi-product catalog broadcasting supports simultaneous updates to WhatsApp Status (Stories), Channels (...@newsletter), Community Announcements, Groups (...@g.us), and safe customer cohort queues directly from /inventory or /whatsapp.
- [whatsapp-commerce-2] Option B implemented: WhatsApp Timed Flash Drops with 10-minute reservation pool, mobile Express 1-Click WhatsApp Checkout with address capture, and Automated VIP Order Milestones Pipeline with photo attachments.
- [tenancy] Multi-account data isolation enforced: strict PocketBase API rules scope authenticated users to account_email = @request.auth.email on read and write, preventing cross-tenant leakage or spoofing.
- [storefront-catalog] PocketBase migration 1792000200 scopes authenticated staff to their own products while allowing unauthenticated public visitors on storefronts to query active catalog items without cross-tenant pollution.
- [whatsapp-media] WhatsApp image attachments from vendor chats are encrypted MMS3 CDN URLs (mmg.whatsapp.net). Ingestion flows must decrypt them via whatsappManager.downloadMedia(msg.id) into data URIs and persist in image_data rather than saving raw URLs.
- [roadmap] Competitive benchmark vs jewelry ERPs (Live Metal Rates, Old Gold POS, Savings Scheme) and novel AI features → strategic-roadmap.md
- [tenancy-storage] All browser localStorage and sessionStorage keys for store data must be strictly suffixed with the authenticated user's email/ID to prevent cross-account pollution.
- [zero-mock] Production code must never include hardcoded business entities, fallback facilities, or fake revenue figures; missing or empty database states must always render empty states.
- [database-first] All tenant CMS and order buffers must be stored in PocketBase with account_email rules, never in static disk JSON files.
- [tenant-dual-layer] Never rely solely on PocketBase API rules for isolation. Admin/superuser logins bypass DB rules. All queries across POS, Inventory, and APIs must explicitly append `account_email = "${userEmail}"` and perform an in-memory ownership check.
- [relational-active-guard] `product_variants` queries must always filter `product.is_active = true` and verify parent active state in mapping to prevent ghost/soft-deleted items from surfacing in POS.
- [audit-integrity] Never state that leakages are plugged without inspecting all call sites of `pb.collection()` across every page in `src/app/`.
- [setup-isolation] When running setup wizard with "Clean Slate", purge operations must be strictly scoped to `account_email = "${adminEmail}"` to prevent accidental wiping of other merchants' data.
- [safe-primitives] In UI templates, never call `.trim()` directly on settings fields (pincode, phone, GSTIN) without `String(val ?? "").trim()`, as numeric fields in databases cause fatal TypeErrors.
- [storefront-binding] In `getStorefrontBinding()`, never fall back to an unscoped `getFirstListItem('key="storefront_content"')` when `preferredEmail` is provided, which leads to tenant account hijacking and order rejections.
- [browser-csv-parser] In Next.js client-side bundles, never import Node.js 'stream' for CSV parsing; use a lightweight, zero-dependency RFC 4180 parser to prevent runtime module resolution crashes.
- [pocketbase-expand-safety] Never call expand on non-existent collection relation fields (e.g., products has no variants relation field, product_variants has product); query the child collection with a filter instead.
- [invoice-lookup-resilience] Invoice retrieval functions must accept both PocketBase record IDs and user-facing invoice numbers (e.g., INV-...) with fallback to getFirstListItem.
- [customer-360-live-aggregation] In Customer 360 profiles, dynamically aggregate lifetime spend and order counts from the live sales collection rather than relying strictly on un-synchronized static record fields.
- [whatsapp-session-tenancy] Multi-tenant WhatsApp session mapping in `getTenantWhatsAppSessionId()` must include user record IDs as well as login emails to ensure live sessions (like `luminila`) stay bound when accessed via user ID.
- [vendor-wholesale-shorthand] In Indian jewelry wholesale messaging, price expressions frequently use shorthand like `500+&` (₹500 + shipping) or `350+ship`. Offer parsing regex must support `\+&` and `\+\s*ship(?:ping)?`.
- [pocketbase-image-data-limit] When saving base64 image data into PocketBase collections, the `text` field `max` constraint must be explicitly set to 5MB (5242880) in `_collections` to prevent 5000-character constraint validation rejections.

