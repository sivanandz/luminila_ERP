# Luminila Documentation Suite

Welcome to the official documentation suite for the **Luminila Fashion Jewelry Inventory Management System**.

This documentation suite provides complete technical, operational, and architectural documentation for developers, store operators, and system administrators.

---

## 📚 Documentation Index

| Document | Description | Target Audience |
|---|---|---|
| **[Architecture Guide](ARCHITECTURE.md)** | Full system architecture, Tauri v2 shell, Next.js 16 frontend, PocketBase 38-collection data tier, service layering, mobile/responsive architecture, and security/RBAC. | Developers, Architects, AI Agents |
| **[Build & Deployment Guide](BUILD_AND_DEPLOYMENT.md)** | Step-by-step instructions for prerequisites, environment configuration, local development, Desktop build, Android APK build, and Cloudflare tunneling. | Developers, DevOps, Release Engineers |
| **[PocketBase Setup Guide](POCKETBASE_SETUP.md)** | Dedicated guide for configuring, migrating, backing up, and networking the local PocketBase SQLite engine. | Database Admins, Developers |
| **[Codebase Guide](../CODEBASE.md)** | Concise developer and AI agent overview of tech stack, module responsibilities, build commands, and architectural rules. | AI Agents, Contributors |
| **[State of the Project](PROJECT_STATE.md)** | Current release status, module maturity matrix, known audit defect registers, technical debt, and release milestones. | Tech Leads, Contributors, Auditors |
| **[Technical Report](TECHNICAL_REPORT.md)** | Comprehensive engineering analysis, sub-system topology, and architectural benchmark report. | Engineers, System Architects |
| **[Features Specification](FEATURES.md)** | Exhaustive breakdown of all 16 functional domains (POS, Shifts, Catalog, Barcodes, GST Invoicing, Challans, GRN, CRM, Loyalty, Banking, WhatsApp, Mobile). | Product Managers, Store Owners |
| **[Operational Workflows & Working Guide](APP_WORKING.md)** | Step-by-step business workflows, service orchestration (`scripts/dev-all.js`), daily cashier routines, and database maintenance. | Store Operators, Cashiers, DevOps |
| **[User Guide](USER_GUIDE.md)** | End-user showroom manual for store staff, cashiers, and retail owners. | Store Staff, Cashiers |

---

## 🧭 Which Document Should I Read?

- **If you are an AI Agent or developer continuing construction:**
  Read **[Codebase Guide](../CODEBASE.md)** first, followed by **[Architecture Guide](ARCHITECTURE.md)** and **[Build & Deployment Guide](BUILD_AND_DEPLOYMENT.md)**.

- **If you are compiling for Windows Desktop or Android Mobile:**
  Follow **[Build & Deployment Guide](BUILD_AND_DEPLOYMENT.md)**.

- **If you are assessing the health and known logic defects of the application:**
  Read **[State of the Project](PROJECT_STATE.md)** and the accompanying [APP_LOGIC_AUDIT_REPORT_2026-03-07.md](../APP_LOGIC_AUDIT_REPORT_2026-03-07.md).

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
