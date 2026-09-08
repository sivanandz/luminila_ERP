# Luminila Documentation Suite

Welcome to the official documentation suite for the **Luminila Fashion Jewelry Inventory Management System**.

This documentation suite provides complete technical, operational, and architectural documentation for developers, store operators, and system administrators.

---

## 📚 Documentation Index

| Document | Description | Target Audience |
|---|---|---|
| **[Architecture Guide](ARCHITECTURE.md)** | Full system architecture, Tauri v2 shell, Next.js 16 frontend, PocketBase 38-collection data tier, service layering, and security/RBAC. | Developers, Architects |
| **[State of the Project](PROJECT_STATE.md)** | Current version status, module maturity matrix, known audit defect registers, technical debt, and release milestones. | Tech Leads, Contributors, Auditors |
| **[Features Specification](FEATURES.md)** | Exhaustive breakdown of all 15 functional domains (POS, Shifts, Catalog, Barcodes, GST Invoicing, Challans, GRN, CRM, Loyalty, Banking, WhatsApp). | Product Managers, Store Owners |
| **[Operational Workflows & Working Guide](APP_WORKING.md)** | Step-by-step business workflows, service orchestration (`scripts/start-all.ps1`), daily cashier routines, and database maintenance. | Store Operators, Cashiers, DevOps |
| **[User Guide](USER_GUIDE.md)** | End-user guide for day-to-day showroom management. | Store Staff, Cashiers |

---

## 🧭 Which Document Should I Read?

- **If you are a new developer setting up the codebase:**
  Start with the **[Architecture Guide](ARCHITECTURE.md)** to understand the system design, followed by the **[Operational Workflows & Working Guide](APP_WORKING.md)** to boot the local environment.

- **If you are assessing the health and current bugs of the application:**
  Read the **[State of the Project](PROJECT_STATE.md)** and the accompanying [APP_LOGIC_AUDIT_REPORT_2026-03-07.md](../APP_LOGIC_AUDIT_REPORT_2026-03-07.md).

- **If you are exploring business capabilities or preparing a release:**
  Read the **[Features Specification](FEATURES.md)**.

- **If you are operating a retail showroom counter:**
  Refer to **[Operational Workflows & Working Guide](APP_WORKING.md)** and **[User Guide](USER_GUIDE.md)**.

---

## 🚀 Quick Startup Command

```powershell
# Boots PocketBase, WhatsApp Sidecar, and Next.js concurrently:
npm run dev:all
```
- **App:** `http://localhost:3000`
- **PocketBase Admin:** `http://127.0.0.1:8090/_/`
- **WhatsApp Sidecar:** `http://127.0.0.1:21465`
