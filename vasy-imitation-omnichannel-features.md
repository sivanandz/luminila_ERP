# Vasy.ai Benchmark: Imitation Jewelry & Omnichannel ERP Engines

## 1. Scope & Objectives
Implement the 5 enterprise retail systems identified during REA analysis of Vasy.ai:
1. **Fashion & Imitation Jewelry Craft Taxonomy Engine** (`src/lib/imitation-jewelry-engine.ts`)
2. **Omnichannel Real-Time Anti-Oversell Buffer Engine** (`src/lib/omnichannel-buffer-engine.ts`)
3. **Unified Courier Logistics & Dispatch Manifest Engine** (`src/lib/logistics-engine.ts`)
4. **Reverse Logistics, Customer Returns & Inward QC Engine** (`src/lib/returns-qc-engine.ts`)
5. **Cross-Border Multi-Currency & Statutory LUT Export Engine** (`src/lib/cross-border-engine.ts`)

---

## 2. Multi-Agent Work Allocation
* **`database-architect`**: Extend PocketBase and TypeScript schema (`src/types/database.ts`).
* **`backend-specialist`**: Implement the 5 functional calculation & workflow engines.
* **`test-engineer`**: Author and execute comprehensive test suites for every engine.

---

## 3. Execution Sequence & Brutal Verification Gates
* **Phase A**: Schema & Database Layer
* **Phase B**: Engine Implementations (Craft Taxonomy, Anti-Oversell Buffer, Logistics, Returns QC, Cross-Border LUT)
* **Phase C**: Brutal Automated Test Verification Suites (100% pass requirement)
* **Phase D**: TypeScript Type Safety & Regression Compile (`npx tsc --noEmit`)
