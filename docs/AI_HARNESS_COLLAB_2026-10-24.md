# AI Harness Collab — 2026-10-24

**Purpose:** coordination forum between the agents working in
`E:\Local_GIT_2\luminila_inv_mgmt`. The user asked us to pair-program: introduce
ourselves, split the work, avoid stepping on each other, and review each other's
changes.

> Read this file before touching a shared file. Append to §5 (Messages); do not
> rewrite another agent's entry.

---

## 1. Participants

| Agent | Where | Current focus |
|---|---|---|
| **LEAD** | DSH desktop session `session-d9756d9b-c780-48e4-a92c-266605081a60` | LLM intelligence: OpenAI-compatible agent harness, tools, API, `/assistant` UI |
| **ai-harness-review** | Agent Teams teammate (independent verifier) | Adversarial review of the harness: SSE, approvals, RBAC, tenant isolation, secret handling |
| **AGENT-2** | DSH desktop session `session-db987208-bd45-47c7-b8be-6f3464273183` ("Ecommerce order data analysis and fixes") | Storefront / WhatsApp order capture hardening (as observed in the working tree) |

There is no in-app message channel between DSH sessions, so this file is the
channel for AGENT-2. Agent Teams messages cover LEAD ↔ ai-harness-review.

---

## 2. What LEAD built (user request)

The user asked for **LLM intelligence inside Luminila**: a harness for
**OpenAI-compatible custom LLM providers** (base URL + API key + model, any
vendor), modelled on:

- `google-research/harness2` — a harness is the system around a model
  (system prompt, guardrails, memory, tool guidance, subagents, skills,
  scripts, plugins); we adopted the **components contract**, not the Python
  benchmark code.
- `deepseek-ai/deepseek-harness` — everything-is-a-plugin runtime with explicit
  capability seams: provider adapter, tool registry, append-only session log
  (`model-visible ⟺ logged`), turn/step loop, system-prompt assembly,
  streaming events, approvals. We adopted the **seams + event-log** design in
  TypeScript inside this Next.js app.

Delivered (all new files unless noted as shared):

```
src/lib/ai/*                      harness core (types, SSE, provider client, prompt,
                                  guardrails, tools, event log, agent loop, sessions)
src/lib/ai-client.ts              browser streaming client + providers API client
src/app/api/ai/*                  chat (SSE), conversations, providers, status
src/app/assistant/page.tsx        chat surface
src/components/assistant/*        chat UI (tool cards, approval cards, provider dialog)
src/hooks/use-ai-chat.ts          streaming hook
pocketbase/pb_migrations/1792900000_ai_harness.js
src/scripts/test-ai-harness.ts                    unit tests (29)
src/scripts/test-ai-harness-integration.ts        fake-provider integration tests (7)
src/scripts/verify-ai-harness-live.ts             live PocketBase verification (39 checks)
docs/AI_HARNESS_ARCHITECTURE_2026-10-24.md        contract, security model, extension guide
```

**Shared files edited by LEAD (nothing else):**
- `src/components/layout/Sidebar.tsx` — one nav entry ("AI Assistant").
- `src/components/layout/MobileDrawer.tsx` — one nav entry.
- `src/scripts/dev-all.js` — untouched.
- `package.json` — two script lines: `test:ai`, `verify:ai`.
- `env.example.txt`, `deploy/env.example` — AI env section.
- `PROJECT_MASTER.md`, `docs/STOREFRONT_*`, `storefront/**`,
  `src/lib/orders.ts`, `src/lib/channel-*.ts`, `src/lib/whatsapp-*.ts`,
  `src/lib/shipments.ts`, `src/app/api/storefront/**`, `tsconfig.json` —
  **NOT touched** (AGENT-2's area).

## 3. Interface contract (for any second consumer / renderer)

`POST /api/ai/chat` (operator Bearer token + `x-tenant-email`) returns
`text/event-stream`:

| event | data |
|---|---|
| `meta` | `{ conversationId, turn, provider, model, profile }` |
| `text` | `{ delta }` |
| `reasoning` | `{ delta }` |
| `tool_call` | `{ callId, name, arguments }` |
| `tool_result` | `{ callId, name, status, summary?, error?, durationMs? }` |
| `approval_request` | `{ callId, name, arguments, risk }` — write tools pause here |
| `usage` | `{ promptTokens, completionTokens, totalTokens? }` |
| `error` | `{ message, code }` |
| `done` | `{ status, conversationId }` |

Approvals resume by re-POSTing `/api/ai/chat` with
`{ conversationId, approvals: [callId] }`. Reads go through
`GET /api/ai/conversations[/id]`; configuration is admin-only through
`/api/ai/providers*`. Errors from the route are JSON `{ success:false, error, code }`
(403/404/409/413/429/503).

## 4. Verification evidence (LEAD, current)

- `npx tsx src/scripts/test-ai-harness.ts` → **29/29 pass**
- `npx tsx src/scripts/test-ai-harness-integration.ts` → **7/7 pass**
  (fragmented SSE, approval pause/resume/replay, denial, tools-unsupported
  fallback, cancellation, maxSteps, excess tool calls)
- `npx tsx src/scripts/verify-ai-harness-live.ts <temp-pb-url>` → **39/39 pass**
  (migration shape/rules, AES-GCM key round trip + no leak, conversation+event
  log persistence/projection, all 9 read tools against the real schema,
  `create_customer` write path + duplicate guard + tenant stamp)
- `npm run typecheck` → clean; `npx eslint` on the new tree → clean.
- Migration note: PocketBase 0.25's JSVM ignores the `fields` array on the
  `Collection` constructor, so the migration adds fields with `fields.add()`
  and adds explicit `created`/`updated` autodate fields. Existing dev DBs get
  the collections on next PocketBase restart (dev-all spawns PB with
  `cwd=pocketbase`, so its default `pb_migrations` is picked up). Manual one-off:
  `pocketbase\pocketbase.exe migrate up --dir=pocketbase\pb_data --migrationsDir=pocketbase\pb_migrations`

## 5. Messages

### 2026-10-24 14:25 IST — LEAD → AGENT-2
Hello. I'm LEAD, building the LLM-harness work the user asked for: an in-app
agent harness for OpenAI-compatible providers (settings + streaming chat + ERP
tools + guardrails), built on the harness2 "system around the model"
decomposition and DSH's seam/event-log design. I claimed the new files in §2;
I only made the small shared edits listed there, and I did not touch your
storefront/orders/WhatsApp files.

If you are building a generative-UI/OpenUI renderer, §3 is the SSE contract — it
is stable now. If you touched `Sidebar.tsx`/`MobileDrawer.tsx`/`package.json`
since 14:00, your changes and mine only add lines; a normal merge should be
clean, but please re-read those files before you save.

I also have an Agent Teams reviewer (`ai-harness-review`) doing independent
adversarial verification. If you want a review exchange, reply here with your
scope and the files you want checked.

### 2026-10-24 15:05 IST — LEAD status → AGENT-2
Implementation is complete and verified (see §4). Remaining LEAD work: production
build check, final doc pass, reviewer findings. Harness additions are additive:
new collections `ai_providers`/`ai_conversations`/`ai_events` (server-only API
rules), new API routes under `/api/ai/*`, new `/assistant` page, one nav line.
No existing service/collection was modified, so this should not disturb your
capture work.

Open question for you (unchanged): are you still planning the OpenUI/genui chat
surface? If yes, consume §3 and tell me if you need anything added to the event
contract.

*(AGENT-2: append your reply below this line.)*


### 2026-10-24 15:25 IST — LEAD review-fix update → AGENT-2
The independent reviewer found one S0 (OpenAI tool_calls wire shape on the second tool step),
plus cross-user conversation scoping, stale-approval handling, provider PATCH resets,
pagination caps, prompt-envelope escaping and several hardening notes. All are fixed;
see docs/AI_HARNESS_ARCHITECTURE_2026-10-24.md §10 for the finding→fix table. Own gates now:
34/34 unit, 8/8 integration (strict provider included), 39/39 live PocketBase checks,
typecheck + scoped eslint clean. No AGENT-2 file was touched; the only shared edits remain
Sidebar/MobileDrawer nav lines, package.json test scripts, and the env examples.

### 2026-10-24 15:55 IST — LEAD final status → AGENT-2
review-verification closure: ai-harness-review re-ran everything against the fixed tree — its own adversarial suite 68/68 pass (all 14 findings renamed REGRESSION-* and green), integration driver 18/18, migration re-applied on a throwaway PocketBase copy. LEAD gates: 34/34 unit, 8/8 integration, 39/39 live checks, typecheck+eslint clean. Reviewer UI pass was clean with four P3 UX nits, all patched (expandable approval arguments, approval-selection resync, optimistic-bubble cleanup on pre-meta failure, delete confirmation). N-01 decision (admin client for tools + capability gate) accepted by the reviewer. Nothing here requires action from AGENT-2; this thread is now documentation of the collaboration.

### 2026-10-24 16:30 IST — LEAD live provider acceptance → AGENT-2
OpenCode Go is now configured in the running app for the store accounts
(`niththigal@gmail.com`, `admin@luminila.local`): base
`https://opencode.ai/inference/go/v1`, model `deepseek-v4.1-flash` (12 curated
chat-protocol models), key encrypted at rest in `ai_providers`. The live AI
migration was applied by restarting PocketBase on :8091 with
`--migrationsDir=pocketbase\pb_migrations`; it now runs as a managed background
process and was healthy for the whole E2E pass.

Live route test through the real app (:3000): status configured; a read turn
executed `get_sales_report` + `get_low_stock` + `get_store_overview` against live
rows and answered; a write turn paused at `approval_request`; the approval
resume created the customer (verified, then deleted). This found and fixed one
real bug: an approval resume without `profileId` was rebuilt under the read-only
profile; the chat route now continues with the conversation's persisted profile
and provider. Also added OpenCode Go's required `x-opencode-session` routing
header (per conversation, automatic for opencode.ai hosts).

Gates after the change: typecheck clean, unit 35/35, integration 8/8, reviewer
suite 68/68, live E2E pass. Details in AI_HARNESS_ARCHITECTURE §11. No AGENT-2
files touched; the only live-DB writes were the Ai provider rows (kept), the AI
migration (kept) and the temporary test user/customer/conversation (deleted).

### 2026-10-24 16:45 IST — LEAD UI move → AGENT-2
Provider management moved out of the assistant page dialog into the Settings menu:
**Settings → AI Providers** (`/settings?tab=ai`) now owns provider CRUD (multiple
providers), model catalogs, default selection, connection test and fetch-models.
The assistant page keeps a "Provider settings" shortcut that opens that tab and the
unconfigured banner points admins there. New component:
`src/components/settings/AiProvidersSettings.tsx`; the old
`src/components/assistant/ProviderSettingsDialog.tsx` was removed. No API or data-model
changes; no AGENT-2 files touched.
