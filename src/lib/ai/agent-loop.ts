/**
 * The agent loop: one model request plus the tools it calls is a *step*; the
 * steps needed to answer one operator message (and its approvals) are a *turn*.
 *
 * This mirrors deepseek-harness's turn/step contract in miniature: the event
 * log is appended as facts are settled, model history is derived from the log,
 * tool calls pause the turn at an approval boundary, and a resume executes only
 * the calls the operator approved, using the arguments that were logged.
 */

import type {
    AiEvent,
    AiEventRecord,
    AiHarnessProfile,
    AiModelMessage,
    AiProviderConfig,
    AiProviderToolSpec,
    AiStreamEvent,
    AiToolCall,
    AiTurnStatus,
    AgentToolRuntime,
} from './types';
import { AiProviderError, AiRequestAbortedError, streamChatCompletion } from './openai-compatible';
import {
    capText,
    decideToolPolicy,
    isCallApproved,
    MAX_SUMMARY_CHARS,
    parseToolArguments,
} from './guardrails';
import { countTurns, deriveModelHistory, getPendingToolCalls, unresolvedCallsInTurn } from './events';

export class AiTurnError extends Error {
    readonly code: string;

    constructor(message: string, code = 'turn_error') {
        super(message);
        this.name = 'AiTurnError';
        this.code = code;
    }
}

export interface RunAgentTurnOptions {
    provider: AiProviderConfig;
    profile: AiHarnessProfile;
    systemPrompt: string;
    /** Capability-filtered tools visible to this operator. */
    tools: AgentToolRuntime[];
    /** Provider schemas for exactly the visible tools. */
    providerTools: AiProviderToolSpec[];
    /** Events already persisted for this conversation (all previous turns). */
    history: AiEventRecord[];
    /** New operator message. Omit when resuming with approvals. */
    input?: string;
    /** Approved call ids for a paused turn. */
    approvals?: string[];
    appendEvent: (event: AiEvent) => Promise<AiEventRecord>;
    emit: (event: AiStreamEvent) => void;
    capabilityCheck: (tool: AgentToolRuntime) => Promise<boolean>;
    signal?: AbortSignal;
    /** Operator email recorded on approval decisions (audit). Required: it is the consent trail. */
    actorEmail: string;
    /** Stable conversation id used as the OpenCode Go routing session. */
    sessionId?: string;
}

export interface RunAgentTurnResult {
    status: AiTurnStatus;
    error?: string;
    events: AiEventRecord[];
}

type ToolCallMode = 'auto' | 'approve' | 'deny';

interface PendingCall {
    callId: string;
    name: string;
    arguments: string;
}

const STORED_RESULT_CHARS = 20_000;

function clampStoredResult(value: unknown): unknown {
    if (value === undefined) return null;
    try {
        const serialized = JSON.stringify(value);
        if (serialized.length <= STORED_RESULT_CHARS) return value;
        return { truncated: true, preview: serialized.slice(0, STORED_RESULT_CHARS - 200) };
    } catch {
        return { truncated: true, note: 'The tool result could not be serialized.' };
    }
}

/** FNV-1a hash used to pin the advertised tool schemas for one turn. */
function toolSchemaFingerprint(schemas: unknown): string {
    const text = JSON.stringify(schemas ?? []);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
    const { provider, profile, systemPrompt, tools, providerTools, emit, appendEvent, capabilityCheck, signal } = options;
    const events: AiEventRecord[] = [...options.history].sort((a, b) => a.seq - b.seq);
    const append = async (event: AiEvent): Promise<AiEventRecord> => {
        const record = await appendEvent(event);
        events.push(record);
        return record;
    };
    const toolByName = new Map<string, AgentToolRuntime>(tools.map((tool) => [tool.name, tool]));
    const approvedIds = new Set((options.approvals ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0));
    const turn = countTurns(events) + 1;
    // Pending approvals belong to the previous tail turn; capture them before
    // this turn's turn/start event makes the tail ambiguous.
    const pendingBeforeTurn = getPendingToolCalls(events);
    const actorEmail = options.actorEmail;
    let trimLogged = false;
    let status: AiTurnStatus = 'completed';
    let errorMessage: string | undefined;

    const emitToolResult = (
        callId: string,
        name: string,
        resultStatus: 'ok' | 'error' | 'denied',
        summary?: string,
        error?: string,
        durationMs?: number
    ): void => {
        emit({
            event: 'tool_result',
            data: {
                callId,
                name,
                status: resultStatus,
                ...(summary ? { summary } : {}),
                ...(error ? { error: capText(error, MAX_SUMMARY_CHARS) } : {}),
                ...(typeof durationMs === 'number' ? { durationMs } : {}),
            },
        });
    };

    const denyCall = async (call: PendingCall, reason: string): Promise<void> => {
        const message = capText(reason, MAX_SUMMARY_CHARS);
        await append({
            type: 'tool/result',
            callId: call.callId,
            name: call.name,
            status: 'denied',
            arguments: capText(call.arguments, MAX_SUMMARY_CHARS),
            error: message,
        });
        emitToolResult(call.callId, call.name, 'denied', undefined, message);
    };

    const runToolCall = async (call: PendingCall, mode: ToolCallMode): Promise<'done' | 'awaiting'> => {
        const tool = toolByName.get(call.name);
        if (!tool) {
            const message = 'This tool is not available in the current harness profile.';
            await append({
                type: 'tool/result',
                callId: call.callId,
                name: call.name,
                status: 'error',
                arguments: capText(call.arguments, MAX_SUMMARY_CHARS),
                error: message,
            });
            emitToolResult(call.callId, call.name, 'error', undefined, message);
            return 'done';
        }
        if (mode === 'deny') {
            await denyCall(call, 'The operator did not approve this write action.');
            return 'done';
        }
        const parsedArgs = parseToolArguments(call.arguments);
        if (!parsedArgs.ok) {
            const message = parsedArgs.error ?? 'The model produced invalid tool arguments.';
            await append({
                type: 'tool/result',
                callId: call.callId,
                name: tool.name,
                status: 'error',
                arguments: capText(call.arguments, MAX_SUMMARY_CHARS),
                error: message,
            });
            emitToolResult(call.callId, tool.name, 'error', undefined, message);
            return 'done';
        }
        const capabilityGranted = tool.capability ? await capabilityCheck(tool) : true;
        const decision = decideToolPolicy({
            toolName: tool.name,
            kind: tool.kind,
            risk: tool.risk,
            profile,
            capabilityGranted,
            approved: mode === 'approve',
        });
        if (!decision.allowed) {
            await denyCall(call, decision.reason ?? 'This action is not permitted.');
            return 'done';
        }
        if (decision.requiresApproval) {
            await append({
                type: 'approval/request',
                callId: call.callId,
                name: tool.name,
                arguments: capText(call.arguments, MAX_SUMMARY_CHARS),
                risk: tool.risk,
            });
            emit({
                event: 'approval_request',
                data: { callId: call.callId, name: tool.name, arguments: call.arguments, risk: tool.risk },
            });
            return 'awaiting';
        }

        emit({ event: 'tool_call', data: { callId: call.callId, name: tool.name, arguments: call.arguments } });
        const startedAt = Date.now();
        try {
            const execution = await tool.execute(parsedArgs.value);
            const durationMs = Date.now() - startedAt;
            const summary = capText(execution.summary ?? '', MAX_SUMMARY_CHARS);
            await append({
                type: 'tool/result',
                callId: call.callId,
                name: tool.name,
                status: 'ok',
                arguments: capText(call.arguments, MAX_SUMMARY_CHARS),
                summary,
                result: clampStoredResult(execution.data),
                durationMs,
            });
            emitToolResult(call.callId, tool.name, 'ok', summary, undefined, durationMs);
        } catch (error) {
            const durationMs = Date.now() - startedAt;
            const message = capText(error instanceof Error ? error.message : 'The tool failed.', MAX_SUMMARY_CHARS);
            await append({
                type: 'tool/result',
                callId: call.callId,
                name: tool.name,
                status: 'error',
                arguments: capText(call.arguments, MAX_SUMMARY_CHARS),
                error: message,
                durationMs,
            });
            emitToolResult(call.callId, tool.name, 'error', undefined, message, durationMs);
        }
        return 'done';
    };

    try {
        await append({
            type: 'turn/start',
            turn,
            profileId: profile.id,
            providerId: provider.id,
            model: provider.model,
            systemPrompt,
            tools: tools.map((tool) => tool.name),
            toolSchemaHash: toolSchemaFingerprint(providerTools),
        });

        const hasInput = typeof options.input === 'string' && options.input.trim().length > 0;
        if (hasInput) {
            // A new message supersedes any abandoned approval prompt: record the
            // decision and resolve the calls as denied so the model history never
            // contains dangling calls.
            for (const pending of pendingBeforeTurn) {
                await append({
                    type: 'approval/decision',
                    callId: pending.callId,
                    name: pending.name,
                    approved: false,
                    decidedBy: actorEmail,
                    at: new Date().toISOString(),
                });
                await denyCall(pending, 'The operator sent a new message instead of approving this tool call.');
            }
            await append({ type: 'user/message', text: options.input!.trim() });
        } else {
            if (options.approvals === undefined) {
                throw new AiTurnError('Provide a message or an approvals list to continue.', 'empty_turn');
            }
            const pending = pendingBeforeTurn;
            if (pending.length === 0) {
                throw new AiTurnError('There are no tool calls waiting for approval.', 'no_pending_approvals');
            }
            for (const call of pending) {
                const tool = toolByName.get(call.name);
                let mode: ToolCallMode = 'auto';
                if (tool?.kind === 'write') {
                    mode = isCallApproved(approvedIds, call.callId) ? 'approve' : 'deny';
                    // Persist the operator's decision before acting on it: the log is
                    // the consent audit trail, not the request body.
                    await append({
                        type: 'approval/decision',
                        callId: call.callId,
                        name: call.name,
                        approved: mode === 'approve',
                        decidedBy: actorEmail,
                        at: new Date().toISOString(),
                    });
                }
                const outcome = await runToolCall(call, mode);
                if (outcome === 'awaiting') {
                    status = 'awaiting_approval';
                    break;
                }
            }
        }

        for (let step = 0; step < profile.maxSteps; step += 1) {
            if (status === 'awaiting_approval') break;
            if (signal?.aborted) {
                status = 'cancelled';
                break;
            }
            const untrimmed = deriveModelHistory(events);
            const history = deriveModelHistory(events, { charBudget: profile.contextCharBudget });
            if (!trimLogged && history.length < untrimmed.length) {
                trimLogged = true;
                await append({
                    type: 'context/trimmed',
                    omittedMessages: untrimmed.length - history.length,
                    charBudget: profile.contextCharBudget,
                });
            }
            const messages: AiModelMessage[] = [{ role: 'system', content: systemPrompt }, ...history];

            let completion;
            try {
                completion = await streamChatCompletion(
                    provider,
                    {
                        messages,
                        tools: providerTools.length > 0 ? providerTools : undefined,
                        sessionId: options.sessionId,
                    },
                    {
                        signal,
                        onTextDelta: (delta) => emit({ event: 'text', data: { delta } }),
                        onReasoningDelta: (delta) => emit({ event: 'reasoning', data: { delta } }),
                    }
                );
            } catch (error) {
                if (error instanceof AiRequestAbortedError) {
                    const partial = error.partial;
                    if (partial.text || partial.reasoning) {
                        await append({
                            type: 'assistant/message',
                            text: partial.text,
                            ...(partial.reasoning ? { reasoning: partial.reasoning } : {}),
                            toolCalls: [],
                            model: provider.model,
                        });
                    }
                    status = 'cancelled';
                    break;
                }
                throw error;
            }

            const toolCalls: AiToolCall[] = completion.toolCalls.map((call) => ({
                id: call.id,
                name: call.name,
                arguments: call.arguments,
            }));
            await append({
                type: 'assistant/message',
                text: completion.text,
                ...(completion.reasoning ? { reasoning: completion.reasoning } : {}),
                toolCalls,
                model: provider.model,
            });
            if (completion.usage) {
                await append({ type: 'usage', usage: completion.usage, model: provider.model, provider: provider.id });
                emit({ event: 'usage', data: completion.usage });
            }

            if (toolCalls.length === 0) {
                if (!completion.text.trim()) {
                    throw new AiTurnError('The model returned an empty response.', 'empty_response');
                }
                status = 'completed';
                break;
            }

            const executable = toolCalls.slice(0, profile.maxToolCallsPerStep);
            const excess = toolCalls.slice(profile.maxToolCallsPerStep);
            let awaiting = false;
            for (const call of executable) {
                const outcome = await runToolCall({ callId: call.id, name: call.name, arguments: call.arguments }, 'auto');
                if (outcome === 'awaiting') {
                    awaiting = true;
                    break;
                }
            }
            for (const call of excess) {
                await denyCall({ callId: call.id, name: call.name, arguments: call.arguments }, `Too many tool calls in one step (limit ${profile.maxToolCallsPerStep}).`);
            }
            if (awaiting) {
                status = 'awaiting_approval';
                break;
            }
            if (step === profile.maxSteps - 1) {
                status = 'max_steps';
                break;
            }
        }
    } catch (error) {
        status = 'error';
        const message = error instanceof Error ? error.message : 'The turn failed.';
        errorMessage = message;
        const code =
            error instanceof AiProviderError
                ? error.code
                : error instanceof AiTurnError
                    ? error.code
                    : 'turn_error';
        emit({ event: 'error', data: { message, code } });
    }

    // A finished/cancelled/failed turn must not leave unresolved tool calls in
    // the log: they would otherwise look approvable later and break log pairing.
    if (status !== 'awaiting_approval') {
        try {
            for (const call of unresolvedCallsInTurn(events)) {
                const message = 'The turn ended before this tool call completed.';
                await append({
                    type: 'tool/result',
                    callId: call.callId,
                    name: call.name,
                    status: 'denied',
                    arguments: capText(call.arguments, MAX_SUMMARY_CHARS),
                    error: message,
                });
                emitToolResult(call.callId, call.name, 'denied', undefined, message);
            }
        } catch {
            // Resolving dangling calls is best-effort; the turn/end event still lands.
        }
    }

    try {
        await append({ type: 'turn/end', status, ...(errorMessage ? { error: errorMessage } : {}) });
    } catch (error) {
        if (!errorMessage) {
            errorMessage = error instanceof Error ? error.message : 'Could not persist the turn result.';
            status = 'error';
        }
    }

    return { status, error: errorMessage, events };
}

