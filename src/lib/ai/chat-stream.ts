/**
 * SSE wrapper around one agent turn.
 *
 * Owns the response stream, the per-conversation sequence counter, client
 * cancellation, the conversation lock release and the post-turn conversation
 * update. `runAgentTurn` stays transport-agnostic so tests can drive it without
 * HTTP.
 */

import type {
    AiEvent,
    AiEventRecord,
    AiHarnessProfile,
    AiProviderConfig,
    AiProviderToolSpec,
    AiStreamEvent,
    AiTurnStatus,
    AgentToolRuntime,
} from './types';
import { encodeSseEvent } from './sse';
import { countTurns } from './events';
import { runAgentTurn } from './agent-loop';

export interface StartTurnStreamOptions {
    requestSignal: AbortSignal;
    conversationId: string;
    provider: AiProviderConfig;
    profile: AiHarnessProfile;
    systemPrompt: string;
    history: AiEventRecord[];
    tools: AgentToolRuntime[];
    providerTools: AiProviderToolSpec[];
    message?: string;
    approvals?: string[];
    /** Operator email persisted on approval decisions. */
    actorEmail: string;
    /** Stable conversation id used as the OpenCode Go routing session. */
    sessionId?: string;
    appendEvent: (event: AiEvent, seq: number) => Promise<AiEventRecord>;
    capabilityCheck: (tool: AgentToolRuntime) => Promise<boolean>;
    onFinished: (status: AiTurnStatus, finalEvents: AiEventRecord[]) => Promise<void>;
    releaseLock: () => void;
}

const SSE_HEADERS: Record<string, string> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
};

export function startTurnStream(options: StartTurnStreamOptions): Response {
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    if (options.requestSignal.aborted) {
        abortController.abort();
    } else {
        options.requestSignal.addEventListener('abort', onAbort, { once: true });
    }

    let seq = options.history.reduce((max, record) => Math.max(max, record.seq), 0);
    const turn = countTurns(options.history) + 1;

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const emit = (event: AiStreamEvent): void => {
                try {
                    controller.enqueue(encoder.encode(encodeSseEvent(event.event, event.data)));
                } catch {
                    // The client disconnected; the abort signal stops the loop.
                }
            };
            emit({
                event: 'meta',
                data: {
                    conversationId: options.conversationId,
                    turn,
                    provider: options.provider.name,
                    model: options.provider.model,
                    profile: options.profile.name,
                },
            });

            let status: AiTurnStatus = 'error';
            try {
                const result = await runAgentTurn({
                    provider: options.provider,
                    profile: options.profile,
                    systemPrompt: options.systemPrompt,
                    tools: options.tools,
                    providerTools: options.providerTools,
                    history: options.history,
                    input: options.message,
                    approvals: options.approvals,
                    appendEvent: (event) => {
                        seq += 1;
                        return options.appendEvent(event, seq);
                    },
                    emit,
                    capabilityCheck: options.capabilityCheck,
                    signal: abortController.signal,
                    actorEmail: options.actorEmail,
                    sessionId: options.sessionId,
                });
                status = result.status;
                await options.onFinished(status, result.events);
                emit({ event: 'done', data: { status, conversationId: options.conversationId } });
            } catch (error) {
                const message = error instanceof Error ? error.message : 'The AI turn failed.';
                emit({ event: 'error', data: { message, code: 'turn_failed' } });
                emit({ event: 'done', data: { status: 'error', conversationId: options.conversationId } });
                try {
                    await options.onFinished('error', []);
                } catch {
                    // Conversation bookkeeping must not mask the streamed error.
                }
            } finally {
                options.requestSignal.removeEventListener('abort', onAbort);
                options.releaseLock();
                try {
                    controller.close();
                } catch {
                    // Already closed by cancellation.
                }
            }
        },
        cancel() {
            abortController.abort();
            options.requestSignal.removeEventListener('abort', onAbort);
            options.releaseLock();
        },
    });

    return new Response(stream, { headers: SSE_HEADERS });
}
