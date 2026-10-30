# Luminila Documentation Suite

Welcome to the official documentation suite for the **Luminila Fashion Jewelry Inventory Management System**.

This documentation suite provides complete technical, operational, and architectural documentation for developers, store operators, and system administrators.

---

## 📚 Documentation Index

| Document | Description | Target Audience |
|---|---|---|
| **[Architecture Guide](ARCHITECTURE.md)** | Full system architecture, Tauri v2 shell, Next.js 16 frontend, PocketBase 44-collection data tier, service layering, mobile/responsive architecture, conversational CRM surfaces, and security/RBAC. | Developers, Architects, AI Agents |
| **[Build & Deployment Guide](BUILD_AND_DEPLOYMENT.md)** | Step-by-step instructions for prerequisites, environment configuration, local development, Desktop build, Android APK build, and Cloudflare tunneling. | Developers, DevOps, Release Engineers |
| **[PocketBase Setup Guide](POCKETBASE_SETUP.md)** | Dedicated guide for configuring, migrating, backing up, and networking the local PocketBase SQLite engine. | Database Admins, Developers |
| **[Codebase Guide](../CODEBASE.md)** | Concise developer and AI agent overview of tech stack, module responsibilities, build commands, and architectural rules. | AI Agents, Contributors |
| **[State of the Project](PROJECT_STATE.md)** | Current release status, module maturity matrix, known audit defect registers, technical debt, and release milestones. | Tech Leads, Contributors, Auditors |
| **[Technical Report](TECHNICAL_REPORT.md)** | Comprehensive engineering analysis, sub-system topology, and architectural benchmark report. | Engineers, System Architects |
| **[Features Specification](FEATURES.md)** | Exhaustive breakdown of all 17 functional domains (POS, Shifts, Catalog, Barcodes, GST Invoicing, Challans, GRN, CRM, Loyalty, Banking, WhatsApp Conversational CRM, Mobile). | Product Managers, Store Owners |
| **[WhatsApp ERP & CRM Blueprint](WHATSAPP_ERP_CRM_SPECIFICATION.md)** | Approved architecture specification for WhatsApp conversational commerce, 3-pane CRM hub, Razorpay links, and anti-ban broadcasts. | Product Managers, Developers, CRM Teams |
| **[WhatsApp Feature Coverage Gap](WHATSAPP_FEATURE_COVERAGE_GAP_2026-10-30.md)** | Audit (2026-10-30) of the sidecar-to-UI gap: 55 dead sidecar routes, 133 unexposed WPPConnect methods, unhandled message types, the unused Socket.IO channel, and the WPPConnect 2.3.6 upgrade. | Developers, Product Managers, CRM Teams |
| **[Operational Workflows & Working Guide](APP_WORKING.md)** | Step-by-step business workflows, service orchestration (`scripts/dev-all.js`), daily cashier routines, and database maintenance. | Store Operators, Cashiers, DevOps |
| **[User Guide](USER_GUIDE.md)** | End-user showroom manual for store staff, cashiers, and retail owners. | Store Staff, Cashiers |
| **[Documentation Verification Report](DOC_VERIFICATION_2026-09-22.md)** | Point-in-time audit (2026-09-22) verifying the documentation suite against the codebase, with corrections and follow-ups. | Tech Leads, Auditors |
| **[AI Harness Architecture](AI_HARNESS_ARCHITECTURE_2026-10-24.md)** | In-app LLM assistant: OpenAI-compatible provider adapter, turn/step agent loop, append-only event log, RBAC-gated ERP tools, approval-gated writes, security model, extension guide, and the independent-review fix log. | Developers, Architects, Store Admins |
| **[SEO & AI Discoverability Report](SEO_AI_OPTIMIZATION.md)** | Storefront technical SEO, structured data, AI crawler policy, Merchant feed, verification results, and the deployment checklist. | Store Owners, Developers, Marketers |
| **[Grounded SEO Standards Brief](SEO_BRIEF.md)** | Official-source requirements, the pre-implementation storefront audit, and hard honesty constraints. | Developers, SEO reviewers |
| **[Storefront SEO Plan](SEO_PLAN.md)** | File-by-file implementation plan, shared contract, and acceptance criteria. | Developers |
| **[Storefront SEO Contract](SEO_CONTRACT.md)** | Maintenance contract for the SEO modules, JSON-LD, routes, and machine-readable surfaces. | Developers, AI Agents |
| **[SEO Source Confirmation](seo-research/00-confirmation.md)** | Bounded verification of eight official URLs and the pre-implementation gap list. | Auditors |

---

## 🧭 Which Document Should I Read?

- **If you are an AI Agent or developer continuing construction:**
  Read **[Codebase Guide](../CODEBASE.md)** first, followed by **[Architecture Guide](ARCHITECTURE.md)** and **[Build & Deployment Guide](BUILD_AND_DEPLOYMENT.md)**.

- **If you are compiling for Windows Desktop or Android Mobile:**
  Follow **[Build & Deployment Guide](BUILD_AND_DEPLOYMENT.md)**.

- **If you are assessing the health and known logic defects of the application:**
  Read **[State of the Project](PROJECT_STATE.md)** and the accompanying [APP_LOGIC_AUDIT_REPORT_2026-03-07.md](../APP_LOGIC_AUDIT_REPORT_2026-03-07.md).

- **If you want to connect an LLM provider or extend the AI assistant:**
  Read **[AI Harness Architecture](AI_HARNESS_ARCHITECTURE_2026-10-24.md)** (providers are managed in **Settings → AI Providers**; providers, tools,
  guardrails, approvals, verification commands), then the coordination note
  **[AI Harness Collab](AI_HARNESS_COLLAB_2026-10-24.md)**.

- **If you are optimizing or auditing the storefront for search, shopping, or AI answers:**
  Read the **[SEO & AI Discoverability Report](SEO_AI_OPTIMIZATION.md)** first, then the
  **[Grounded SEO Standards Brief](SEO_BRIEF.md)** and the
  **[Storefront SEO Contract](SEO_CONTRACT.md)**.

- **If you are exploring business capabilities or preparing a release:**
  Read **[Features Specification](FEATURES.md)**.

- **If you are operating a retail showroom counter:**
  Refer to **[Operational Workflows & Working Guide](APP_WORKING.md)** and **[User Guide](USER_GUIDE.md)**.

---

## 🚀 Quick Startup Commands

```bash
# Boots PocketBase, WhatsApp Sidecar, and Next.js concurrently:
npm run dev:all

# Desktop App Development (Tauri v2):
npm run tauri:dev

# Mobile Android Development (Tauri v2):
npx tauri android dev
```

- **Web App:** `http://localhost:3000`
- **PocketBase Admin:** `http://127.0.0.1:8090/_/`
- **WhatsApp Sidecar:** `http://127.0.0.1:21465`
