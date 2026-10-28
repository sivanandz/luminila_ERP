# AI Harness Architecture — 2026-10-24

The in-app AI assistant for Luminila: a harness around an
**OpenAI-compatible model provider** that can read the store's ERP data through
guarded tools, and (in the Operations profile) request data-changing actions
that only execute after explicit operator approval.

This is a deliberate, small adaptation of two references the user supplied:

| Reference | What we took | What we did **not** take |
|---|---|---|
| `google-research/harness2` | The "a harness is the system around the model" decomposition: system prompt, guardrails, memory/context, tool guidance, skills (profiles), plugins/seams. | The Python benchmark code, the Propose–Probe–Compose recursion and benchmark harness. |
| `deepseek-ai/deepseek-harness` | Capability seams (provider adapter, tool registry, session log, loop), append-only event log as the source of model history ("model-visible ⟺ logged"), turn/step loop, streaming events, approval boundaries, server-owned credentials. | Cordis/plugin runtime, session forks, subagents, providers beyond OpenAI-compatible HTTP. |

## 1. Layering

```
Browser (React)                 Server (Next.js route handlers, Node runtime)         External
─────────────────               ─────────────────────────────────────────────         ────────
/assistant page                 POST /api/ai/chat ─┐
use-ai-chat hook                GET  /api/ai/...   ├─► src/lib/ai/agent-loop.ts ──► openai-compatible.ts ──► provider
ai-client.ts ◄── SSE events ──  src/lib/ai/chat-stream.ts                           (chat/completions + /models)
        │                       src/lib/ai/http.ts (auth, RBAC, rate limit, lock)
        │                       src/lib/ai/tools/* ──► PocketBase (operator client)
        └── Settings → AI Providers ─► /api/ai/providers* ─► providers.ts ─► PocketBase (superuser client)
```

- **Browser** never receives a provider API key or `AES-256-GCM` ciphertext;
  settings show only masked metadata (`AiProviderPublic`).
- **Route handlers** authenticate the operator (bearer PB token), resolve the
  tenant, apply rate limits and a per-conversation lock, then hand a prepared
  runtime to the loop.
- **Agent loop** is transport-agnostic and dependency-injected; unit tests and
  the fake-provider integration suite drive it directly.
- **Tools** run against the tenant admin PocketBase client with the tenant
  account email bound server-side and the operator's RBAC capability checked
  before execution (see N-01 decision in §4).
- **Server-owned collections** (providers/conversations/events) are written
  with a superuser client scoped to the session's own database instance and
  account email.

### Where each harness2 component lives

| Component | Implementation |
|---|---|
| System prompt | `src/lib/ai/prompt.ts` (`buildSystemPrompt`) |
| Guardrails | `src/lib/ai/guardrails.ts` (policy), HTTP layer (auth, rate limit, body caps), loop (approval boundary, step/tool limits) |
| Memory / context | Append-only `ai_events` log + `src/lib/ai/events.ts` (`deriveModelHistory`, `trimModelHistory`) |
| Tool guidance | `src/lib/ai/tools/registry.ts` (zod schemas → provider JSON Schema, profile allow-list, capability gate) |
| Skills | Harness profiles: `src/lib/ai/harness.ts` (analyst vs operator) |
| Subagents | Not implemented (single agent); approval resume is the only multi-step suspension |
| Scripts | Not applicable in-app |
| Plugins | Seams: provider adapter, tool registry, event log, transport, profiles — all replaceable modules |

## 2. Turn / step flow

A **turn** is one operator message (or one approval resume). A **step** is one
model request plus the tools it requests.

```
POST /api/ai/chat
  authenticate operator → resolve tenant → rate limit → resolve provider
  create/load conversation → acquire per-conversation lock (409 if busy)
  load event log → filter tools by profile + RBAC → assemble system prompt
  stream:
    meta
    turn/start   (persisted with systemPrompt, provider/model, tool names)
    user/message (or resume: execute approved pending calls first)
    loop (≤ profile.maxSteps):
      derive model history from the log
      provider stream → text/reasoning deltas → assistant/message persisted
      context/trimmed logged once per turn when history exceeds the budget
      if no tool calls → completed
      for each tool call (≤ maxToolCallsPerStep):
         policy: profile → capability → approval
         read tool runs now; write tool without approval:
             approval/request persisted + streamed, turn ends "awaiting_approval"
         execute → tool/result persisted + streamed
      (unresolved calls of a finished/failed/cancelled turn are written as
       denied results so the log pairing stays valid)
    turn/end (status)
    done
```

Resuming an approval re-enters at the pending calls:
approved write calls execute once (args come from the logged assistant message),
denied calls get a denied `tool/result`, then the loop continues. Every resume
first persists an `approval/decision` event (call id, approved/denied, operator,
timestamp) so consent is audit-logged, not just requested. A replay sees no
pending calls and fails cleanly; the per-conversation lock prevents two
concurrent turns from interleaving sequence numbers. Pending calls are derived
only from a tail turn whose last `turn/end` status is `awaiting_approval`, so a
call dangling from an earlier errored/cancelled turn is never approvable later.

### Event vocabulary (`ai_events.payload`)

`turn/start`, `user/message`, `assistant/message`, `tool/result`,
`approval/request`, `approval/decision`, `context/trimmed`, `usage`,
`turn/end`. `turn/start` persists the exact system prompt, the advertised tool
names and an FNV-1a hash of the tool schemas, so a request is reconstructable
from the log.

The log is append-only (no update or delete API rule). `deriveModelHistory()`
folds it into OpenAI messages and truncates before an unresolved tool-call
assistant message, so a paused or crashed turn can never send an assistant
`tool_calls` message without its matching tool replies. The system prompt used
for a turn is persisted on `turn/start`, which keeps the "model-visible ⟺
logged" invariant: a replay can reconstruct what the model saw.

## 3. Provider adapter

Any endpoint implementing OpenAI Chat Completions works:

- `POST {baseUrl}/chat/completions` with `Authorization: Bearer <key>`,
  `stream: true`, optional `tools` + `tool_choice: "auto"`,
  `stream_options.include_usage`, `temperature`, `max_tokens` (or
  `max_completion_tokens` per provider setting).
- The assistant history is serialized in the **OpenAI wire shape**:
  `tool_calls: [{ id, type: "function", function: { name, arguments } }]` plus
  matching `role:"tool"` replies. This matters on every step after a tool call —
  strict OpenAI-compatible providers reject the internal shape.
- `GET {baseUrl}/models` for the model picker / connection test (falls back to a
  1-token completion when `/models` is absent).
- A 45 s idle timeout and a 4 MB per-response cap abort a stalled or hostile
  stream; legacy `function_call` deltas are normalised to a single tool call.
- SSE parsing handles `\r\n`/`\r`, comments, multi-line `data:`, chunk
  fragmentation (including mid-UTF-8 splits), interleaved tool-call deltas by
  index, usage-only frames and `[DONE]`.
- Non-streaming JSON responses are accepted (some gateways ignore `stream`).
- Compatibility fallbacks are narrow: a `400/422/404` that explicitly names
  `tools`/`tool_choice` may retry once without tools; one that names
  `stream_options`/`include_usage` may retry once without it. Auth, rate-limit
  and server errors are never retried, and nothing is retried after streaming
  starts. A malformed stream frame surfaces `provider_stream_error`.
- Error messages are redacted: the API key and custom header values are
  replaced with `[redacted]` before any message reaches the UI or logs.
- Providers: rows in `ai_providers` (admin-defined, encrypted keys) or an
  optional environment provider (`OPENAI_COMPAT_*`). Selection precedence:
  explicit `providerId` → default row → first enabled row → environment.

### Verified provider recipes

| Provider | Base URL | Notes |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | Chat Completions + tools |
| DeepSeek | `https://api.deepseek.com/v1` | Chat Completions + tools |
| OpenRouter | `https://openrouter.ai/api/v1` | Chat Completions + tools |
| Ollama / LM Studio | `http://127.0.0.1:11434/v1` | No key needed for loopback |
| **OpenCode Go** | `https://opencode.ai/inference/go/v1` | See below |

**OpenCode Go**: the base URL must be `https://opencode.ai/inference/go/v1`
(not `.../inference/go`, which 404s, and not `.../inference/openai/v1`, which
routes to the pay-as-you-go gateway and returns 402 for a Go key). Every request
needs the `x-opencode-session` routing header, so the adapter adds it
automatically for `opencode.ai` hosts, using the conversation id as the session
(stable per conversation, no extra configuration). `/models` works at the same
base (the routing header is sent there too) and powers the model picker in Settings → AI Providers; the host check is exact (opencode.ai / *.opencode.ai), so look-alike domains never receive it.

Only models served through the **Chat Completions** protocol work through this
adapter. On Go that includes `deepseek-v4.1-flash`, `deepseek-v4-pro`, `glm-5.3`,
`glm-5.3-flash`, `glm-5.2`, `glm-5.1`, `kimi-k3`, `minimax-m3`,
`minimax-m3.1-flash`, `hy3`, `longcat-2.0`, `mimo-v2.6-flash`. Claude, GPT and
Grok entries use the Anthropic/Responses protocols and return
`ModelProtocolUnsupported` on this endpoint, so they are not offered.

## 4. Security model

**Authentication and tenant scope**
- Every `/api/ai/*` request requires the operator's PocketBase bearer token
  (`authenticateOperator`, tenant hint header `x-tenant-email`).
- ERP reads run through the operator's PB client, so collection rules still
  apply. Tenant scope for tools is `users.account_email` (store owner) when the
  operator record carries it, else the signed-in email; it is never taken from
  the request body or model arguments.
- Server-owned AI collections have all API rules `null` (superuser only). The
  admin client is created for the **same PocketBase origin the session was
  verified against**, not a process-global "active tenant".
- Conversations are **creator-scoped**: list/detail/resume/archive filter on
  `account_email` **and** `created_by` (the signed-in operator), so one staff
  login cannot list or resume another user's transcript. Legacy rows with an
  empty `account_email` are excluded from AI reads (strict fail-closed choice).
- Tools execute on the **tenant admin client** with the code-enforced tenant
  account filter and an RBAC capability check (decision N-01). PocketBase's
  per-row `account_email = @request.auth.email` rules would otherwise make a
  cashier's AI tools read nothing at all; the capability gate is the
  authorization boundary and the AI collections stay server-only.

**RBAC and approvals**
- Provider management is admin-only (`settings:update` or superuser).
- A tool is visible to the model only if (a) the harness profile allows it and
  (b) the operator's role grants its capability (checked again at execution).
- All write tools require an approval for the exact pending call id, persisted
  in the log of this conversation. Arguments come from the logged assistant
  message, not from the resume request. One approval executes a call once, and
  the decision itself is persisted as `approval/decision` (who, when, outcome).
- The per-conversation lock returns `409 conversation_busy` for concurrent turns
  and expires stale locks after 10 minutes.

**Secrets**
- `api_key` is encrypted at rest with AES-256-GCM
  (`src/lib/tenant-secrets.ts`). Key preference: `AI_SECRET_KEY`, then
  `TENANT_REGISTRY_KEY`. Missing key → `503 missing_secret_key`; undecryptable
  value → `503 provider_key_undecryptable` (never an empty-key call).
- The public projection exposes `hasApiKey:boolean`, never plaintext or
  ciphertext.
- Provider base URLs must be `http(s)` and cannot embed credentials; custom
  header names/values are validated (no CRLF injection). Note: because this is a
  local-first desktop app, private/loopback provider URLs (e.g. Ollama) are
  intentionally allowed.

**Prompt injection and data safety**
- Tool results are returned to the model inside a `<tool_result trusted="false">`
  envelope, with `<`/`>` escaped inside the payload so store data cannot forge the
  closing tag. Tenant-controlled prompt values (store name, city, GSTIN, role)
  are stripped of control characters and heading markers before interpolation.
- Tool arguments are bounded in size, JSON-parsed, then zod-validated. Tool
  results are capped before storage and again before prompt insertion.
- The system prompt never includes provider keys or secrets; store context is
  limited to display-safe settings.

**Limits**
- 30 chat requests/minute per tenant+operator; separate buckets of 120/min for
  read endpoints and 20/min for configuration; 256 KiB JSON body cap enforced on
  the stream, not only on `content-length`; `maxSteps`/`maxToolCallsPerStep` per
  profile; `contextCharBudget` per profile; provider timeout (default 120 s)
  plus idle and response-size caps; abort on client disconnect.

## 5. Data model (migration `1792900000_ai_harness.js`)

| Collection | Purpose | Key fields |
|---|---|---|
| `ai_providers` | Provider rows (admin) | `account_email`, `name`, `base_url`, `api_key` (AES-GCM), `model`, `models`, `custom_headers`, `temperature`, `max_tokens`, `max_tokens_param`, `supports_tools`, `enabled`, `is_default`, `timeout_ms`, `last_test_ok`, `last_tested_at`, `created_by` |
| `ai_conversations` | Thread + status | `account_email`, `created_by`, `title`, `profile_id`, `provider_id`, `model`, `status`, `archived`, `last_message_at` |
| `ai_events` | Append-only log | `conversation` (relation, cascade), `account_email`, `created_by`, `seq`, `type`, `payload` (JSON), `tool_name`, `tool_call_id`, `status`, `duration_ms` |

All three: API rules `null` (server-only), indexes on account and
`conversation+seq`, explicit `created`/`updated` autodate fields. Event log
reads paginate newest-first with a hard cap (`MAX_EVENTS_LOADED`) instead of
paging through the whole history on every turn.

PocketBase 0.25 migration gotchas (both cost a debug cycle):
1. The JSVM ignores the `fields: [...]` array passed to `new Collection(...)`
   — create the collection, then `collection.fields.add(...)` and `app.save()`.
   Without this the collection exists with only its system `id`.
2. That path also skips the implicit `created`/`updated` autodate fields; add
   them explicitly with `new AutodateField(...)`, or sorts/filters on `updated`
   fail with "no such column".

## 6. Profiles

| Profile | Writes | Steps | Use |
|---|---|---|---|
| `analyst` (default) | none | 6 | Read-only analysis; write tools are not even offered to the model |
| `operator` | `create_customer`, `add_order_note` after approval | 8 | Staff copilot for small, auditable data changes |

Tool list: 9 read tools (overview, product search, low stock, customer search,
orders, order detail, invoices, sales report, expenses summary, record-by-id)
and 2 write tools. Every tool has a zod schema, a capability and a risk label.

## 7. Extending

**Add a tool** (`src/lib/ai/tools/erp-read.ts` or `erp-write.ts`):
1. Add a zod `input` schema.
2. Add a `readTools`/`writeTools` entry: `name`, `title`, `description`,
   `kind`, `risk`, `capability` (`{ resource, action }` from RBAC), `input`,
   `execute(context, args)`.
3. Use `accountFilter(context.accountEmail)` in every filter; never take a
   tenant from the model. Register writes in the operator profile only and give
   them a clear risk label.
4. Add a unit test (schema conversion) and, if it touches new collections, a
   check in `verify-ai-harness-live.ts`.

**Add a profile**: add a definition in `src/lib/ai/harness.ts` with its
allow-list, write policy and budgets — the UI and registry pick it up
automatically.

**Add a provider shape**: `openai-compatible.ts` is the only module that talks
HTTP; adapt `buildChatCompletionRequest`/`streamChatCompletion` and keep the
`AiProviderConfig` contract.

## 8. Testing and verification

```bash
npm run typecheck                     # whole repo
npm run test:ai                       # 34 unit + 8 fake-provider integration tests
npm run verify:ai -- <temp-pb-url>    # 39 live checks against a throwaway PB copy
npm run build                         # production build (catches client/server boundary issues)
```

A separate live pass drives the **real Next.js routes** (`/api/ai/status`,
    `POST /api/ai/chat`, approval resume) against the running app and a real
    provider: it verified OpenCode Go end to end on 2026-10-24 with a temporary
    admin user scoped to the store owner — status 200/configured, three real read
    tools (`get_sales_report`, `get_low_stock`, `get_store_overview`) returning live
    rows, a write turn pausing at `approval_request`, and the resume creating a
    customer that was verified in PocketBase and then cleaned up.

The integration suite starts a real `node:http` OpenAI-compatible server and
drives `runAgentTurn`: fragmented SSE + UTF-8 splits, a read-tool round trip,
approval pause → approve → resume, approval replay rejection, denial path,
tools-unsupported fallback, cancellation with partial text, `maxSteps`,
excess-tool-call denial, and a **strict provider** that validates the OpenAI
wire shape and tool-reply pairing of the second request. The live script creates
one temporary provider,
conversation and customer against a **copy** of the dev database and cleans them
up.

## 9. Known limitations / next steps

- Write surface is intentionally tiny (create customer, append order note).
  More writes (draft orders, payments) need their own approval + audit review.
  Order notes never truncate existing text; only a 100k safety ceiling is enforced.
- Only the OpenAI **Chat Completions** protocol is implemented. Providers whose
  models require the OpenAI Responses or Anthropic Messages protocol (e.g. GPT,
  Claude, Grok entries on OpenCode Go) are rejected by the provider and must be
  reached through a chat-completions-compatible gateway or not used yet.
- AI tools run on the tenant admin client (N-01 decision): RBAC capability checks
  are the authorization boundary for AI reads/writes, not PocketBase per-row
  rules. The AI collections themselves remain unreachable from the browser.
- No conversation summarisation/compaction yet: old turns are trimmed by
  character budget, losing the oldest context first.
- No token cost accounting; `usage` is persisted and shown but not priced.
- Streaming tool results are persisted only at settlement; a very long tool run
  shows "running" in the UI without partial output.
- Multi-tenant routing relies on the existing `x-tenant-email` hint and the
  session's verified PocketBase origin; staff accounts whose
  `users.account_email` differs from the owner are scoped to the owner's data
  (intended), but legacy rows without `account_email` are invisible to tools.
- The `/assistant` page renders plain markdown + tool cards. The OpenUI
  packages in `package.json` can be layered on top of the stable SSE contract
  (§3 in the collab doc) as a renderer; the harness does not depend on them.

## 10. Independent review fixes (2026-10-24)

An Agent Teams reviewer (`ai-harness-review`) ran an adversarial suite against
this harness and reported 14 findings plus functional notes. All code findings
were fixed in one pass; the evidence is the re-run of both suites (34/34 unit,
8/8 integration incl. the strict-provider scenario) and 39/39 live checks.

| Finding | Severity | Resolution |
|---|---|---|
| F-01 OpenAI `tool_calls` wire shape | **S0** | `toWireMessage` maps to `{id,type:"function",function:{name,arguments}}`; strict-provider integration test added |
| F-02 cross-user conversation access | S1 | conversations list/get/resume/archive require matching `created_by` (operator); routes pass the operator email |
| F-03 `findRecordById` fail-open | S2 | strict tenant clause in the query itself |
| F-04 order-note front truncation | S2 | existing notes preserved; only the new segment is bounded; hard 100k ceiling rejects |
| F-05 `getFullList` made limits meaningless | S2 | `getList` with a real cap; aggregations bounded at 500 rows |
| F-06 approval decisions unlogged | S2 | `approval/decision` event (call, outcome, operator, timestamp) persisted before execution |
| F-07 stale calls approvable | S2 | pending = unresolved calls of a tail `awaiting_approval` turn; finished/failed turns write denied results for unresolved calls |
| F-08 provider PATCH reset settings | S2 | update preserves omitted `enabled`/`supports_tools`/`custom_headers` |
| F-09/F-13 envelope unused/unescaped | P2 | `wrapToolResultForModel` used by `historyContentForToolResult`; delimiters escaped, heading markers stripped from prompt values |
| F-10 store-name prompt injection | P2 | control chars, quotes, backticks and `#` stripped before interpolation |
| F-11 event-load page size vs cap | S2 | newest-first pagination with a hard `MAX_EVENTS_LOADED` cap |
| F-12 legacy `function_call` dropped | P3 | stream and non-stream shapes normalised to one tool call |
| F-14 body cap only with content-length | P3 | request stream read with an explicit byte bound |
| N-01 staff token could not read owner rows | S1 | decision: tools run on the tenant admin client with tenant scope + RBAC capability gate (documented above) |
| N-06 status leaked unfiltered tool names | P3 | removed |
| N-07 record-by-id RBAC mismatch | P2 | tool limited to products/variants with `products:read` |
| N-09 orphan-start trim | P3 | window never starts on a tool message |
| N-10 `jsonOk` success override | P3 | payload spread before the `success:true` flag |
| N-02 streaming idle/size caps | P2 | 45 s idle timeout + 4 MB cap abort the fetch |
| N-03 partial log fidelity | P2 | `turn/start` stores system prompt + tool names + schema hash; `context/trimmed` event logged |
| N-08 shared limiter | P3 | read endpoints have their own bucket |

Two reviewer test fixtures intentionally encode the *old* behaviour and were
superseded by the fixes: the fixture that asserted "any unresolved call anywhere
is pending" (F-07 requires the opposite) and the static fabricated event array
for F-06 (the decision event can only be produced by executing a resume; the
integration suite now proves it). Those fixture updates belong to the reviewer.

## 11. Live provider acceptance — OpenCode Go (2026-10-24)

Configured in the running app for the store accounts (`niththigal@gmail.com`,
`admin@luminila.local`): provider **OpenCode Go**, base
`https://opencode.ai/inference/go/v1`, default model `deepseek-v4.1-flash`,
12 curated Chat-Completions models, key encrypted at rest with the deployment's
`TENANT_REGISTRY_KEY`, API key never rendered in the UI.

What was actually executed against `http://127.0.0.1:3000` with a temporary
Admin user scoped to the store owner:

| Check | Result |
|---|---|
| `GET /api/ai/status` | 200, `configured:true`, provider listed |
| Read turn ("sales last 7 days + low stock") | 200 stream; 3 tool calls; all tool results `ok`; final markdown answer with real rows |
| Write turn ("create customer…") | 200 stream; paused at `approval_request` (no pre-execution) |
| Approval resume | 200 stream; `create_customer` result `ok`; row verified in PocketBase with the owner `account_email`; then deleted |
| Cleanup | temporary user/roles/conversations/customer removed; provider kept |

Two defects were found by this live pass and fixed:

- **Resume profile drift (S1)**: an approval resume that omitted `profileId` was
  rebuilt with the default read-only Analyst profile, so the approved write tool
  was "not available in the current harness profile". The chat route now loads
  the conversation first and continues with its persisted **profile and provider**;
  the client can no longer downgrade (or upgrade) a paused turn by omission.
- **OpenCode Go routing header (compat)**: requests without `x-opencode-session`
  are rejected with 400 `MissingSessionID`. The adapter adds the header for
  `opencode.ai` hosts using the conversation id, overridable by an explicit
  custom header.

Regression gates after these changes: unit 35/35, fake-provider integration 8/8,
independent adversarial suite 68/68, `npm run typecheck` clean, scoped eslint
clean, live E2E pass. Base URL gotcha recorded above (`.../inference/go/v1`).
