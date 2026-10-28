/**
 * OpenAI-compatible transport.
 *
 * Any provider that implements the OpenAI Chat Completions API works here:
 * a custom base URL, a bearer key, `tools` with function schemas, and
 * `stream: true`. The module never logs or rethrows the API key; every error
 * string is redacted before it leaves this file.
 *
 * Pure helpers (`buildChatCompletionRequest`) are separated from the network
 * call so tests can assert URLs, headers and bodies without a server.
 */

import type {
    AiModelMessage,
    AiProviderConfig,
    AiProviderTestResult,
    AiProviderToolSpec,
    AiToolCall,
} from './types';
import {
    extractOpenAiErrorMessage,
    OpenAiStreamTracker,
    parseOpenAiCompletion,
    SseParser,
    type OpenAiUsageRaw,
} from './sse';
import { redactSecrets } from './guardrails';

const MAX_ERROR_BODY_CHARS = 2_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STREAM_BYTES = 4 * 1024 * 1024;
const STREAM_IDLE_TIMEOUT_MS = 45_000;

export interface ChatCompletionInput {
    messages: AiModelMessage[];
    tools?: AiProviderToolSpec[];
    stream?: boolean;
    temperature?: number;
    maxTokens?: number;
    /** Some gateways reject `stream_options`; the transport retries without it. */
    includeStreamOptions?: boolean;
    /**
     * Stable per-conversation id. OpenCode Go requires it in the
     * `x-opencode-session` routing header; other providers ignore it.
     */
    sessionId?: string;
}

export interface BuiltChatRequest {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
}

export interface StreamHandlers {
    signal?: AbortSignal;
    onTextDelta?: (delta: string) => void;
    onReasoningDelta?: (delta: string) => void;
}

export interface ChatCompletionResult {
    text: string;
    reasoning: string;
    toolCalls: AiToolCall[];
    usage?: AiEventUsage;
    finishReason?: string;
    model: string;
    /** True when the provider rejected tools and the call was retried without them. */
    toolsUnsupported: boolean;
}

interface AiEventUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

/** Error carrying a browser-safe message; never contains the API key. */
export class AiProviderError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly bodySnippet?: string;

    constructor(message: string, options: { code?: string; status?: number; bodySnippet?: string } = {}) {
        super(message);
        this.name = 'AiProviderError';
        this.code = options.code ?? 'provider_error';
        this.status = options.status;
        this.bodySnippet = options.bodySnippet;
    }
}

/** Thrown when the caller aborted; carries whatever was streamed so far. */
export class AiRequestAbortedError extends Error {
    readonly partial: { text: string; reasoning: string; toolCalls: AiToolCall[] };

    constructor(partial: { text: string; reasoning: string; toolCalls: AiToolCall[] }) {
        super('The request was cancelled.');
        this.name = 'AiRequestAbortedError';
        this.partial = partial;
    }
}

const OPENCODE_SESSION_HEADER = 'x-opencode-session';

/** True only for the OpenCode inference gateway (opencode.ai or *.opencode.ai). */
export function isOpenCodeHost(baseUrl: string): boolean {
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        return host === 'opencode.ai' || host.endsWith('.opencode.ai');
    } catch {
        return false;
    }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
    const expected = name.toLowerCase();
    return Object.keys(headers).some((key) => key.toLowerCase() === expected);
}

/** Strip trailing slashes and a possibly duplicated endpoint suffix. */
export function normalizeProviderBaseUrl(baseUrl: string): string {
    let value = (baseUrl || '').trim().replace(/\s+/g, '');
    value = value.replace(/\/+$/, '');
    value = value.replace(/\/chat\/completions$/i, '');
    return value;
}

export function buildChatCompletionsUrl(baseUrl: string): string {
    return `${normalizeProviderBaseUrl(baseUrl)}/chat/completions`;
}

export function buildModelsUrl(baseUrl: string): string {
    return `${normalizeProviderBaseUrl(baseUrl)}/models`;
}

/** Header values must not smuggle CR/LF into the request line. */
export function sanitizeHeaderValue(name: string, value: string): string {
    if (/[\r\n]/.test(value)) {
        throw new AiProviderError(`Provider header "${name}" contains an invalid line break.`, {
            code: 'invalid_provider_header',
        });
    }
    return value.trim();
}

function assertHttpUrl(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new AiProviderError('The provider base URL is not a valid URL.', { code: 'invalid_provider_url' });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new AiProviderError('The provider base URL must use http or https.', { code: 'invalid_provider_url' });
    }
    if (parsed.username || parsed.password) {
        throw new AiProviderError('The provider base URL must not embed credentials; use the API key field.', {
            code: 'invalid_provider_url',
        });
    }
    return url;
}

/** Build the exact HTTP request for one chat completion. */
export function buildChatCompletionRequest(
    provider: AiProviderConfig,
    input: ChatCompletionInput
): BuiltChatRequest {
    const url = assertHttpUrl(buildChatCompletionsUrl(provider.baseUrl));
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: input.stream === false ? 'application/json' : 'text/event-stream',
    };
    for (const [name, value] of Object.entries(provider.customHeaders ?? {})) {
        if (!name || name.toLowerCase() === 'authorization') continue;
        headers[name] = sanitizeHeaderValue(name, value);
    }
    if (provider.apiKey) {
        headers.Authorization = `Bearer ${provider.apiKey}`;
    }
    // OpenCode Go requires a per-conversation routing header. Add it only for
    // opencode.ai endpoints (and let an explicitly configured header win).
    if (isOpenCodeHost(provider.baseUrl) && !hasHeader(headers, OPENCODE_SESSION_HEADER)) {
        headers[OPENCODE_SESSION_HEADER] = input.sessionId || `luminila-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    const body: Record<string, unknown> = {
        model: provider.model,
        messages: input.messages.map(toWireMessage),
        stream: input.stream !== false,
        temperature: input.temperature ?? provider.temperature,
        [provider.maxTokensParam === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens']:
            input.maxTokens ?? provider.maxTokens,
    };
    if (body.stream === true && input.includeStreamOptions !== false) {
        body.stream_options = { include_usage: true };
    }
    if (input.tools && input.tools.length > 0 && provider.supportsTools) {
        body.tools = input.tools;
        body.tool_choice = 'auto';
    }
    return { url, headers, body };
}

function toWireMessage(message: AiModelMessage): Record<string, unknown> {
    const wire: Record<string, unknown> = { role: message.role, content: message.content };
    if (message.tool_calls && message.tool_calls.length > 0) {
        // OpenAI wire shape: the internal {id,name,arguments} form is not valid
        // for the next request; strict providers reject it.
        wire.tool_calls = message.tool_calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
        }));
    }
    if (message.tool_call_id) wire.tool_call_id = message.tool_call_id;
    // `name` is intentionally not sent: the internal message keeps it for logs,
    // but strict gateways reject unexpected fields on tool messages.
    return wire;
}

/** Combine the caller's abort signal with a timeout without leaking listeners. */
function createAbortScope(signal: AbortSignal | undefined, timeoutMs: number): {
    signal: AbortSignal;
    cleanup: () => void;
    didTimeOut: () => boolean;
    abort: () => void;
} {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, Math.max(1_000, timeoutMs || DEFAULT_TIMEOUT_MS));
    const onAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }
    return {
        signal: controller.signal,
        didTimeOut: () => timedOut,
        abort: () => controller.abort(),
        cleanup: () => {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
        },
    };
}

function redactProviderError(text: string, provider: AiProviderConfig): string {
    return redactSecrets(text, [
        provider.apiKey,
        ...Object.values(provider.customHeaders ?? {}),
    ]);
}

function errorMessageForStatus(status: number, detail: string): string {
    if (status === 401 || status === 403) {
        return 'The provider rejected the API key. Check the key and base URL in AI settings.';
    }
    if (status === 404) {
        return 'The provider endpoint was not found. Check the base URL (it usually ends with /v1).';
    }
    if (status === 429) {
        return 'The provider rate-limited the request. Wait a moment and try again.';
    }
    if (status === 400 || status === 422) {
        return `The provider rejected the request: ${detail || 'check the model name and provider compatibility'}.`;
    }
    if (status >= 500) {
        return `The provider failed with status ${status}. Try again or switch models.`;
    }
    return `The provider returned status ${status}${detail ? `: ${detail}` : ''}.`;
}

function normalizeUsage(raw: OpenAiUsageRaw | undefined): AiEventUsage | undefined {
    if (!raw) return undefined;
    const usage: AiEventUsage = {};
    if (typeof raw.prompt_tokens === 'number') usage.promptTokens = raw.prompt_tokens;
    if (typeof raw.completion_tokens === 'number') usage.completionTokens = raw.completion_tokens;
    if (typeof raw.total_tokens === 'number') usage.totalTokens = raw.total_tokens;
    return Object.keys(usage).length > 0 ? usage : undefined;
}

function readBodySnippet(text: string, provider: AiProviderConfig): string {
    const redacted = redactProviderError(text, provider);
    let detail = redacted.trim();
    try {
        const parsed = JSON.parse(redacted) as unknown;
        if (parsed && typeof parsed === 'object') {
            const record = parsed as Record<string, unknown>;
            if (record.error !== undefined) detail = extractOpenAiErrorMessage(record.error);
            else if (typeof record.message === 'string') detail = record.message;
        }
    } catch {
        // Keep the raw text.
    }
    return detail.slice(0, MAX_ERROR_BODY_CHARS);
}

/**
 * Compatibility fallbacks must be narrow: only an explicit "unsupported
 * parameter" rejection (400/422/404) may drop `tools` or `stream_options`, and
 * never after any token has been streamed. Auth, rate-limit and server errors
 * are reported as-is.
 */
function classifyCompatibilityFallback(
    status: number | undefined,
    body: string
): 'tools' | 'stream_options' | null {
    if (status !== 400 && status !== 422 && status !== 404) return null;
    const unsupported = /(not support|unsupported|unknown|unrecognized|invalid|not allowed|does not support|unavailable)/i;
    if (!unsupported.test(body)) return null;
    if (/\b(tool|tools|tool_choice|function|functions)\b/i.test(body)) return 'tools';
    if (/(stream_options|include_usage|stream option)/i.test(body)) return 'stream_options';
    return null;
}

/**
 * Stream one chat completion. Calls `onTextDelta`/`onReasoningDelta` as chunks
 * arrive and resolves with the fully assembled response, including tool calls.
 *
 * Retries are limited to request-shape compatibility: a provider that rejects
 * tools gets one retry without tools, and one that rejects `stream_options`
 * gets one retry without that option. Nothing is retried after streaming
 * starts.
 */
export async function streamChatCompletion(
    provider: AiProviderConfig,
    input: ChatCompletionInput,
    handlers: StreamHandlers = {}
): Promise<ChatCompletionResult> {
    let useTools = Boolean(input.tools && input.tools.length > 0 && provider.supportsTools);
    let includeStreamOptions = input.includeStreamOptions !== false;
    let toolsUnsupported = false;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await streamOnce(
                provider,
                { ...input, tools: useTools ? input.tools : undefined, includeStreamOptions },
                handlers,
                toolsUnsupported
            );
        } catch (error) {
            if (!(error instanceof AiProviderError)) throw error;
            const reason = classifyCompatibilityFallback(error.status, error.bodySnippet ?? error.message);
            if (reason === 'tools' && useTools) {
                useTools = false;
                toolsUnsupported = true;
                continue;
            }
            if (reason === 'stream_options' && includeStreamOptions) {
                includeStreamOptions = false;
                continue;
            }
            throw error;
        }
    }
    throw new AiProviderError('The provider rejected every compatible request shape.', {
        code: 'provider_incompatible',
    });
}

async function streamOnce(
    provider: AiProviderConfig,
    input: ChatCompletionInput,
    handlers: StreamHandlers,
    toolsUnsupported: boolean
): Promise<ChatCompletionResult> {
    const request = buildChatCompletionRequest(provider, { ...input, stream: true });
    const scope = createAbortScope(handlers.signal, provider.timeoutMs || DEFAULT_TIMEOUT_MS);
    const tracker = new OpenAiStreamTracker();
    let response: Response;
    try {
        response = await fetch(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal: scope.signal,
        });
    } catch (error) {
        scope.cleanup();
        if (scope.didTimeOut()) {
            throw new AiProviderError('The provider did not answer in time. Check the base URL or increase the timeout.', {
                code: 'provider_timeout',
            });
        }
        if (isAbortError(error)) {
            throw new AiRequestAbortedError({ text: '', reasoning: '', toolCalls: [] });
        }
        throw new AiProviderError('Could not reach the provider. Check the base URL and network access.', {
            code: 'provider_unreachable',
        });
    }

    try {
        if (!response.ok) {
            const bodyText = await response.text().catch(() => '');
            const detail = readBodySnippet(bodyText, provider);
            throw new AiProviderError(errorMessageForStatus(response.status, detail), {
                code: `provider_http_${response.status}`,
                status: response.status,
                bodySnippet: detail,
            });
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
            const payload = await response.json();
            const parsed = parseOpenAiCompletion(payload);
            return {
                text: parsed.text,
                reasoning: parsed.reasoning,
                toolCalls: parsed.toolCalls,
                usage: normalizeUsage(parsed.usage),
                finishReason: parsed.finishReason,
                model: provider.model,
                toolsUnsupported,
            };
        }

        // Streaming path. Some gateways advertise text/event-stream but send a
        // plain JSON error body on failure; the decoder handles both.
        const reader = response.body?.getReader();
        if (!reader) {
            throw new AiProviderError('The provider returned an empty response body.', { code: 'empty_response' });
        }
        const decoder = new TextDecoder('utf-8');
        const parser = new SseParser();
        const consume = (frames: ReturnType<SseParser['push']>) => {
            for (const frame of frames) {
                const updates = tracker.consumeFrame(frame);
                for (const update of updates) {
                    if (update.content) handlers.onTextDelta?.(update.content);
                    if (update.reasoning) handlers.onReasoningDelta?.(update.reasoning);
                    if (update.error) {
                        throw new AiProviderError(redactProviderError(update.error, provider), {
                            code: 'provider_stream_error',
                        });
                    }
                }
            }
        };

        let receivedBytes = 0;
        for (;;) {
            let idleTimer: ReturnType<typeof setTimeout> | undefined;
            const idle = new Promise<never>((_resolve, reject) => {
                idleTimer = setTimeout(() => {
                    // Abort the fetch as well: the idle reader would otherwise stay open.
                    scope.abort();
                    reject(new AiProviderError('The provider stream went idle for too long.', { code: 'provider_idle_timeout' }));
                }, STREAM_IDLE_TIMEOUT_MS);
            });
            let read: ReadableStreamReadResult<Uint8Array>;
            const readPromise = reader.read();
            // If the idle branch wins, the read promise may still reject later
            // (AbortError); keep that rejection handled.
            readPromise.catch(() => undefined);
            try {
                read = await Promise.race([readPromise, idle]);
            } finally {
                if (idleTimer) clearTimeout(idleTimer);
            }
            if (read.done) break;
            receivedBytes += read.value.byteLength;
            if (receivedBytes > MAX_STREAM_BYTES) {
                scope.abort();
                await reader.cancel().catch(() => undefined);
                throw new AiProviderError('The provider stream exceeded the maximum allowed size.', {
                    code: 'provider_stream_too_large',
                });
            }
            consume(parser.push(decoder.decode(read.value, { stream: true })));
            if (tracker.done) break;
        }
        consume(parser.flush());

        if (tracker.error) {
            throw new AiProviderError(redactProviderError(tracker.error, provider), {
                code: 'provider_stream_error',
            });
        }
        return {
            text: tracker.text,
            reasoning: tracker.reasoning,
            toolCalls: tracker.assembledToolCalls(),
            usage: normalizeUsage(tracker.usage),
            finishReason: tracker.finishReason,
            model: provider.model,
            toolsUnsupported,
        };
    } catch (error) {
        if (error instanceof AiProviderError || error instanceof AiRequestAbortedError) throw error;
        if (scope.didTimeOut()) {
            throw new AiProviderError('The provider stopped responding mid-stream.', { code: 'provider_timeout' });
        }
        if (isAbortError(error)) {
            throw new AiRequestAbortedError({
                text: tracker.text,
                reasoning: tracker.reasoning,
                toolCalls: tracker.assembledToolCalls(),
            });
        }
        throw new AiProviderError('The provider response could not be read.', { code: 'provider_stream_failed' });
    } finally {
        scope.cleanup();
    }
}

function isAbortError(error: unknown): boolean {
    return Boolean(error) && typeof error === 'object' && (error as { name?: string }).name === 'AbortError';
}

/** GET /models; tolerant of providers that return `{data:[...]}` or a bare list. */
export async function listProviderModels(
    provider: AiProviderConfig,
    options: { signal?: AbortSignal; sessionId?: string } = {}
): Promise<string[]> {
    const url = assertHttpUrl(buildModelsUrl(provider.baseUrl));
    const scope = createAbortScope(options.signal, Math.min(provider.timeoutMs || 30_000, 30_000));
    try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
        for (const [name, value] of Object.entries(provider.customHeaders ?? {})) {
            if (!name || name.toLowerCase() === 'authorization') continue;
            headers[name] = sanitizeHeaderValue(name, value);
        }
        // OpenCode Go may require the routing header on discovery endpoints too.
        if (isOpenCodeHost(provider.baseUrl) && !hasHeader(headers, OPENCODE_SESSION_HEADER)) {
            headers[OPENCODE_SESSION_HEADER] =
                options.sessionId || `luminila-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        }
        const response = await fetch(url, { headers, signal: scope.signal });
        if (!response.ok) {
            const bodyText = await response.text().catch(() => '');
            throw new AiProviderError(errorMessageForStatus(response.status, readBodySnippet(bodyText, provider)), {
                code: `provider_http_${response.status}`,
                status: response.status,
            });
        }
        const payload = (await response.json()) as unknown;
        const list = Array.isArray(payload)
            ? payload
            : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).data)
                ? ((payload as Record<string, unknown>).data as unknown[])
                : [];
        return list
            .map((entry) => {
                if (typeof entry === 'string') return entry;
                if (entry && typeof entry === 'object') {
                    const id = (entry as Record<string, unknown>).id;
                    if (typeof id === 'string') return id;
                }
                return '';
            })
            .filter((id) => id.length > 0)
            .sort((a, b) => a.localeCompare(b));
    } finally {
        scope.cleanup();
    }
}

/**
 * Validate a provider configuration end to end. Tries `/models` first; if the
 * provider does not expose it, a one-token chat completion verifies auth and
 * model availability instead.
 */
export async function testProviderConnection(
    provider: AiProviderConfig,
    options: { signal?: AbortSignal } = {}
): Promise<AiProviderTestResult> {
    const startedAt = Date.now();
    try {
        const models = await listProviderModels(provider, options);
        return { ok: true, latencyMs: Date.now() - startedAt, models };
    } catch (modelsError) {
        if (modelsError instanceof AiProviderError && modelsError.status === 401) {
            return { ok: false, latencyMs: Date.now() - startedAt, error: modelsError.message };
        }
        try {
            await streamChatCompletion(
                provider,
                {
                    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
                    stream: false,
                },
                { signal: options.signal }
            );
            return { ok: true, latencyMs: Date.now() - startedAt };
        } catch (chatError) {
            const message = chatError instanceof Error ? chatError.message : 'The provider could not be reached.';
            return { ok: false, latencyMs: Date.now() - startedAt, error: message };
        }
    }
}
