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
