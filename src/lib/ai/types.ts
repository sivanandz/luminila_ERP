/**
 * Shared vocabulary for the in-app LLM harness.
 *
 * The harness mirrors the two references the user supplied:
 * - google-research/harness2: a harness is the system *around* a model
 *   (system prompt, guardrails, memory, tool guidance, skills, plugins).
 * - deepseek-ai/deepseek-harness: capability seams plus one append-only event
 *   log that is the single source of model-visible history — "model-visible
 *   means logged".
 *
 * This module is dependency-free on purpose: the browser client
 * (`src/lib/ai-client.ts`), the chat UI and the test scripts all import the
 * same types, so no Node-only code may leak in here.
 */

export type AiMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** One model-facing tool call, in OpenAI-compatible shape. */
export interface AiToolCall {
    id: string;
    name: string;
    arguments: string;
}

/** One entry of the derived OpenAI-compatible message history. */
export interface AiModelMessage {
    role: AiMessageRole;
    content: string | null;
    tool_calls?: AiToolCall[];
    tool_call_id?: string;
    name?: string;
}

export type AiMaxTokensParam = 'max_tokens' | 'max_completion_tokens';

/** How a provider was configured: a stored row or the deployment environment. */
export type AiProviderSource = 'database' | 'environment';

/**
 * A resolved provider configuration. `apiKey` is plaintext and this object
 * only ever exists server-side; `AiProviderPublic` is the browser-safe view.
 */
export interface AiProviderConfig {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    /** Models discovered through GET /models, for the settings UI. */
    models: string[];
    customHeaders: Record<string, string>;
    temperature: number;
    maxTokens: number;
    maxTokensParam: AiMaxTokensParam;
    supportsTools: boolean;
    enabled: boolean;
    isDefault: boolean;
    timeoutMs: number;
    source: AiProviderSource;
}

/** Browser-safe provider metadata: never contains the API key. */
export interface AiProviderPublic {
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    models: string[];
    temperature: number;
    maxTokens: number;
    maxTokensParam: AiMaxTokensParam;
    supportsTools: boolean;
    enabled: boolean;
    isDefault: boolean;
    hasApiKey: boolean;
    source: AiProviderSource;
    lastTestOk?: boolean;
    lastTestedAt?: string;
}

/** Input accepted by the admin-only provider settings endpoint. */
export interface AiProviderInput {
    name: string;
    baseUrl: string;
    model: string;
    /** Omit on update to keep the stored key. */
    apiKey?: string;
    models?: string[];
    customHeaders?: Record<string, string>;
    temperature?: number;
    maxTokens?: number;
    maxTokensParam?: AiMaxTokensParam;
    supportsTools?: boolean;
    enabled?: boolean;
    isDefault?: boolean;
}

/** Which ERP tools a harness profile may use, and its loop budgets. */
export interface AiHarnessProfile {
    id: string;
    name: string;
    description: string;
    /** `'*'` enables every tool the operator's role allows. */
    allowedTools: string[] | '*';
    /** Write tools stay unavailable until the operator approves each call. */
    allowWrites: boolean;
    maxSteps: number;
    maxToolCallsPerStep: number;
    contextCharBudget: number;
    extraSystemPrompt?: string;
}

export type AiToolKind = 'read' | 'write';
export type AiToolRisk = 'low' | 'medium' | 'high';

/** Result of running one tool: a short summary plus optional structured data. */
export interface AiToolExecution {
    summary: string;
    data?: unknown;
}

/**
 * A capability required to run a tool. Kept as plain strings so this module
 * stays dependency-free; the server maps them to the RBAC `Resource` and
 * `Permission` unions.
 */
export interface AiToolCapability {
    resource: string;
    action: string;
}

/** One tool as the agent loop sees it (schema and handler already bound). */
export interface AgentToolRuntime {
    name: string;
    kind: AiToolKind;
    risk: AiToolRisk;
    capability?: AiToolCapability;
    execute: (args: unknown) => Promise<AiToolExecution>;
}

export interface AiEventUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

export type AiTurnStatus = 'completed' | 'awaiting_approval' | 'error' | 'max_steps' | 'cancelled';

/**
 * The append-only event vocabulary. Each event is one durable fact; the model
 * history, the chat transcript and the audit trail are all projections of the
 * same log.
 */
export type AiEvent =
    | {
        type: 'turn/start';
        turn: number;
        profileId: string;
        providerId?: string;
        model?: string;
        /** Exact system prompt used for this turn, so the request is reconstructable from the log. */
        systemPrompt?: string;
        tools?: string[];
        /** FNV-1a hash of the serialized tool schemas advertised for this turn. */
        toolSchemaHash?: string;
    }
    | { type: 'user/message'; text: string }
    | {
        type: 'assistant/message';
        text: string;
        reasoning?: string;
        toolCalls: AiToolCall[];
        model?: string;
    }
    | {
        type: 'tool/result';
        callId: string;
        name: string;
        status: 'ok' | 'error' | 'denied';
        arguments?: string;
        summary?: string;
        result?: unknown;
        error?: string;
        durationMs?: number;
    }
    | { type: 'approval/request'; callId: string; name: string; arguments: string; risk: AiToolRisk }
    | {
        type: 'approval/decision';
        callId: string;
        name: string;
        approved: boolean;
        decidedBy?: string;
        at?: string;
    }
    | { type: 'context/trimmed'; omittedMessages: number; charBudget: number }
    | { type: 'usage'; usage: AiEventUsage; model?: string; provider?: string }
    | { type: 'turn/end'; status: AiTurnStatus; error?: string };

/** One persisted log row, ordered by `seq` inside a conversation. */
export interface AiEventRecord {
    /** PocketBase record id; absent for records built in memory. */
    id?: string;
    conversationId?: string;
    seq: number;
    created?: string;
    event: AiEvent;
}

/** Server-sent event names emitted by POST /api/ai/chat. */
export type AiStreamEventName =
    | 'meta'
    | 'text'
    | 'reasoning'
    | 'tool_call'
    | 'tool_result'
    | 'approval_request'
    | 'usage'
    | 'error'
    | 'done';

export interface AiStreamMeta {
    conversationId: string;
    turn: number;
    provider: string;
    model: string;
    profile: string;
}

export interface AiStreamToolResult {
    callId: string;
    name: string;
    status: 'ok' | 'error' | 'denied';
    summary?: string;
    error?: string;
    durationMs?: number;
}

export type AiStreamEvent =
    | { event: 'meta'; data: AiStreamMeta }
    | { event: 'text'; data: { delta: string } }
    | { event: 'reasoning'; data: { delta: string } }
    | { event: 'tool_call'; data: { callId: string; name: string; arguments: string } }
    | { event: 'tool_result'; data: AiStreamToolResult }
    | { event: 'approval_request'; data: AiPendingApproval }
    | { event: 'usage'; data: AiEventUsage }
    | { event: 'error'; data: { message: string; code?: string } }
    | { event: 'done'; data: { status: AiTurnStatus; conversationId: string } };

/** Request body of POST /api/ai/chat. */
export interface AiChatRequestBody {
    conversationId?: string;
    /** New user message. Omit when resuming with approvals. */
    message?: string;
    /** Tool call ids the operator explicitly approved. */
    approvals?: string[];
    profileId?: string;
    providerId?: string;
}

export interface AiConversationSummary {
    id: string;
    title: string;
    profileId: string;
    providerId: string;
    model: string;
    status: AiTurnStatus | 'idle';
    archived: boolean;
    lastMessageAt?: string;
    created?: string;
    updated?: string;
}

export interface AiToolResultView {
    callId: string;
    name: string;
    status: 'ok' | 'error' | 'denied';
    summary?: string;
    error?: string;
    durationMs?: number;
}

/** One rendered message in a conversation transcript. */
export interface AiConversationMessage {
    /** Stable key derived from the event sequence. */
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    /** Only for role `system`: distinguishes a turn failure from an informational note. */
    kind?: 'error' | 'info';
    turn: number;
    text?: string;
    reasoning?: string;
    toolCalls?: AiToolCall[];
    toolResult?: AiToolResultView;
    createdAt?: string;
}

export interface AiPendingApproval {
    callId: string;
    name: string;
    arguments: string;
    risk: AiToolRisk;
}

export interface AiConversationDetail {
    conversation: AiConversationSummary;
    messages: AiConversationMessage[];
    pendingApprovals: AiPendingApproval[];
}

/** Response of GET /api/ai/status. */
export interface AiStatusPayload {
    configured: boolean;
    providers: Array<Pick<AiProviderPublic, 'id' | 'name' | 'model' | 'isDefault' | 'source'>>;
    profiles: Array<Pick<AiHarnessProfile, 'id' | 'name' | 'description' | 'allowWrites'>>;
    tools: Array<{ name: string; title: string; kind: AiToolKind; capability?: AiToolCapability }>;
    limits: { maxSteps: number; maxToolCallsPerStep: number; requestsPerMinute: number };
}

/** Response of POST /api/ai/providers/test. */
export interface AiProviderTestResult {
    ok: boolean;
    latencyMs: number;
    models?: string[];
    error?: string;
}

/** One item in the OpenAI-compatible tools array. */
export interface AiProviderToolSpec {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
