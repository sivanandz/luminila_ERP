/**
 * Browser client for the in-app AI harness.
 *
 * Owns the runner's bearer token and tenant hint, parses the SSE stream from
 * POST /api/ai/chat into typed events, and wraps the admin-only provider
 * configuration endpoints. No provider secret ever reaches this module: the
 * server returns masked metadata only.
 */

import { pb } from './pocketbase';
import { SseParser } from './ai/sse';
import type {
    AiChatRequestBody,
    AiConversationDetail,
    AiConversationSummary,
    AiProviderInput,
    AiProviderPublic,
    AiProviderTestResult,
    AiStatusPayload,
    AiStreamEvent,
} from './ai/types';

export class AiClientError extends Error {
    readonly code?: string;
    readonly status?: number;

    constructor(message: string, options: { code?: string; status?: number } = {}) {
        super(message);
        this.name = 'AiClientError';
        this.code = options.code;
        this.status = options.status;
    }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const token = pb.authStore.token;
    const model = (pb.authStore.record ?? pb.authStore.model) as { email?: string } | null;
    const email = typeof model?.email === 'string' ? model.email.trim().toLowerCase() : '';
    return {
        ...extra,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(email ? { 'x-tenant-email': email } : {}),
    };
}

async function readError(response: Response): Promise<AiClientError> {
    let payload: { error?: string; code?: string } = {};
    try {
        payload = (await response.json()) as { error?: string; code?: string };
    } catch {
        // Non-JSON error body.
    }
    return new AiClientError(payload.error || `Request failed with status ${response.status}.`, {
        code: payload.code,
        status: response.status,
    });
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(url, { headers: authHeaders(), signal, cache: 'no-store' });
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(url, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal,
    });
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
}

export async function getAiStatus(signal?: AbortSignal): Promise<AiStatusPayload> {
    const payload = await getJson<{ success: boolean } & AiStatusPayload>('/api/ai/status', signal);
    return payload;
}

export async function listAiConversations(signal?: AbortSignal): Promise<AiConversationSummary[]> {
    const payload = await getJson<{ conversations: AiConversationSummary[] }>('/api/ai/conversations', signal);
    return payload.conversations;
}

export async function getAiConversation(
    id: string,
    signal?: AbortSignal
): Promise<AiConversationDetail> {
    return getJson<AiConversationDetail & { success: boolean }>(`/api/ai/conversations/${encodeURIComponent(id)}`, signal);
}

export async function deleteAiConversation(id: string): Promise<void> {
    const response = await fetch(`/api/ai/conversations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    if (!response.ok) throw await readError(response);
}

export interface ProvidersResponse {
    providers: AiProviderPublic[];
}

export async function listAiProviders(signal?: AbortSignal): Promise<AiProviderPublic[]> {
    const payload = await getJson<ProvidersResponse>('/api/ai/providers', signal);
    return payload.providers;
}

export async function saveAiProvider(
    provider: AiProviderInput,
    id?: string
): Promise<AiProviderPublic> {
    const payload = await postJson<{ provider: AiProviderPublic }>('/api/ai/providers', { id, provider });
    return payload.provider;
}

export async function deleteAiProvider(id: string): Promise<void> {
    const response = await fetch(`/api/ai/providers?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    if (!response.ok) throw await readError(response);
}

export async function testAiProvider(payload: {
    id?: string;
    provider?: AiProviderInput;
}): Promise<AiProviderTestResult> {
    return postJson<AiProviderTestResult & { success: boolean }>('/api/ai/providers/test', payload);
}

export async function listAiProviderModels(payload: {
    id?: string;
    provider?: AiProviderInput;
}): Promise<string[]> {
    const result = await postJson<{ models: string[] }>('/api/ai/providers/models', payload);
    return result.models;
}

export interface StreamAiChatOptions {
    signal?: AbortSignal;
    onEvent: (event: AiStreamEvent) => void;
}

/**
 * POST /api/ai/chat and dispatch parsed SSE events until `done`.
 *
 * A non-2xx response becomes `AiClientError` carrying the server's code so the
 * UI can distinguish "not configured" (503) from "conversation busy" (409).
 */
export async function streamAiChat(
    request: AiChatRequestBody,
    options: StreamAiChatOptions
): Promise<void> {
    const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
        body: JSON.stringify(request),
        signal: options.signal,
    });
    if (!response.ok) throw await readError(response);
    if (!response.body) throw new AiClientError('The AI stream could not be opened.', { code: 'empty_stream' });

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const parser = new SseParser();

    const dispatch = (frames: ReturnType<SseParser['push']>): void => {
        for (const frame of frames) {
            if (!frame.event) continue;
            let data: unknown = {};
            if (frame.data) {
                try {
                    data = JSON.parse(frame.data);
                } catch {
                    continue;
                }
            }
            options.onEvent({ event: frame.event, data } as AiStreamEvent);
        }
    };

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            dispatch(parser.push(decoder.decode(value, { stream: true })));
        }
        dispatch(parser.flush());
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // Reader already released after cancellation.
        }
    }
}
