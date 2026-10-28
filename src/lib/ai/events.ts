/**
 * The event log is the single source of model-visible history.
 *
 * This module folds the append-only `AiEventRecord[]` into three projections:
 *  - model history for the next provider request,
 *  - the chat transcript the UI renders,
 *  - the pending-approval queue for write tools.
 *
 * It is pure, so resume/approval semantics are testable without PocketBase.
 */

import { wrapToolResultForModel } from './prompt';
import type {
    AiConversationMessage,
    AiEvent,
    AiEventRecord,
    AiModelMessage,
    AiPendingApproval,
    AiToolCall,
    AiToolRisk,
    AiTurnStatus,
} from './types';

export interface DeriveHistoryOptions {
    /** Approximate character budget for the messages sent to the model. */
    charBudget?: number;
}

export interface PendingToolCall {
    callId: string;
    name: string;
    arguments: string;
}

function sorted(events: AiEventRecord[]): AiEventRecord[] {
    return [...events].sort((a, b) => a.seq - b.seq);
}

export function nextEventSeq(events: AiEventRecord[]): number {
    let max = 0;
    for (const record of events) {
        if (record.seq > max) max = record.seq;
    }
    return max + 1;
}

export function appendLocalEvent(
    events: AiEventRecord[],
    event: AiEvent,
    conversationId?: string
): AiEventRecord {
    const record: AiEventRecord = {
        server_seq_placeholder: undefined,
        conversationId,
        seq: nextEventSeq(events),
        event,
    } as AiEventRecord;
    events.push(record);
    return record;
}

/** Number of completed or in-flight turns in a conversation. */
export function countTurns(events: AiEventRecord[]): number {
    return events.filter((record) => record.event.type === 'turn/start').length;
}

/** Unresolved tool calls in the newest turn only (after the last turn/start). */
export function unresolvedCallsInTurn(events: AiEventRecord[]): PendingToolCall[] {
    const ordered = sorted(events);
    let turnStart = -1;
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
        if (ordered[index].event.type === 'turn/start') {
            turnStart = index;
            break;
        }
    }
    const window = turnStart === -1 ? ordered : ordered.slice(turnStart);
    const resolved = new Set<string>();
    for (const record of window) {
        if (record.event.type === 'tool/result') resolved.add(record.event.callId);
    }
    const pending: PendingToolCall[] = [];
    for (const record of window) {
        if (record.event.type !== 'assistant/message') continue;
        for (const call of record.event.toolCalls) {
            if (resolved.has(call.id)) continue;
            pending.push({ callId: call.id, name: call.name, arguments: call.arguments });
        }
    }
    return pending;
}

/**
 * Tool calls the operator can still approve: unresolved calls of the tail turn,
 * and only when that turn actually paused at an approval boundary. Calls left
 * behind by an errored/cancelled/completed turn are never approvable.
 */
export function getPendingToolCalls(events: AiEventRecord[]): PendingToolCall[] {
    const ordered = sorted(events);
    let lastStatus: string | null = null;
    for (const record of ordered) {
        if (record.event.type === 'turn/end') lastStatus = record.event.status;
    }
    if (lastStatus !== 'awaiting_approval') return [];
    return unresolvedCallsInTurn(ordered);
}

/** Pending approvals enriched with the tool's risk label for the UI. */
export function getPendingApprovals(
    events: AiEventRecord[],
    riskFor: (toolName: string) => AiToolRisk
): AiPendingApproval[] {
    return getPendingToolCalls(events).map((call) => ({
        callId: call.callId,
        name: call.name,
        arguments: call.arguments,
        risk: riskFor(call.name),
    }));
}

function historyContentForToolResult(event: Extract<AiEvent, { type: 'tool/result' }>): string {
    const payload =
        event.status === 'ok'
            ? JSON.stringify({ ok: true, summary: event.summary ?? '', data: event.result ?? null })
            : JSON.stringify({ ok: false, error: event.error ?? 'Tool execution failed.' });
    // Tool output is untrusted data; keep it inside an escaped envelope so store
    // text cannot forge the delimiter.
    return wrapToolResultForModel(event.name, payload);
}

/**
 * Fold the log into OpenAI-compatible messages.
 *
 * Unresolved tool calls (a turn waiting for approval) truncate the history
 * before that assistant message: an assistant tool-call message without its
 * results would be rejected by providers, and the paused turn never asks the
 * model for another step anyway.
 */
export function deriveModelHistory(
    events: AiEventRecord[],
    options: DeriveHistoryOptions = {}
): AiModelMessage[] {
    const ordered = sorted(events);
    const resolvedCallIds = new Set<string>();
    for (const record of ordered) {
        if (record.event.type === 'tool/result') resolvedCallIds.add(record.event.callId);
    }

    const messages: AiModelMessage[] = [];
    for (const record of ordered) {
        const event = record.event;
        if (event.type === 'user/message') {
            messages.push({ role: 'user', content: event.text });
            continue;
        }
        if (event.type === 'assistant/message') {
            if (event.toolCalls.some((call) => !resolvedCallIds.has(call.id))) break;
            messages.push({
                role: 'assistant',
                content: event.text ? event.text : event.toolCalls.length > 0 ? null : '',
                ...(event.toolCalls.length > 0 ? { tool_calls: event.toolCalls } : {}),
            });
            continue;
        }
        if (event.type === 'tool/result') {
            messages.push({
                role: 'tool',
                tool_call_id: event.callId,
                name: event.name,
                content: historyContentForToolResult(event),
            });
        }
    }

    return trimModelHistory(messages, options.charBudget);
}

/**
 * Keep the newest part of the history within a character budget without ever
 * splitting an assistant tool-call message from its tool results.
 */
export function trimModelHistory(messages: AiModelMessage[], charBudget?: number): AiModelMessage[] {
    if (!charBudget || charBudget <= 0) return messages;

    const units: AiModelMessage[][] = [];
    for (let i = 0; i < messages.length; i += 1) {
        const message = messages[i];
        if (message.role === 'assistant') {
            const unit = [message];
            let j = i + 1;
            while (j < messages.length && messages[j].role === 'tool') {
                unit.push(messages[j]);
                j += 1;
            }
            units.push(unit);
            i = j - 1;
        } else {
            units.push([message]);
        }
    }

    const costOf = (unit: AiModelMessage[]): number =>
        unit.reduce((total, message) => {
            const contentCost = message.content?.length ?? 0;
            const toolCost = (message.tool_calls ?? []).reduce(
                (sum, call) => sum + call.name.length + call.arguments.length,
                0
            );
            return total + contentCost + toolCost + 16;
        }, 0);

    let startIndex = units.length - 1;
    let total = 0;
    for (let i = units.length - 1; i >= 0; i -= 1) {
        const cost = costOf(units[i]);
        if (i < units.length - 1 && total + cost > charBudget) break;
        total += cost;
        startIndex = i;
        // Never start the window on an orphan tool result.
        if (units[i][0]?.role === 'tool') continue;
    }

    // Never start the window on an orphan tool message.
    while (startIndex < units.length - 1 && units[startIndex][0]?.role === 'tool') startIndex += 1;
    let flattened = units.slice(startIndex).flat();
    while (flattened.length > 1 && flattened[0].role === 'tool') flattened = flattened.slice(1);
    // Keep the current request: prefer the window from the last user message.
    const lastUserIndex = flattened.reduce((index, message, position) => (message.role === 'user' ? position : index), -1);
    if (lastUserIndex > 0) flattened = flattened.slice(lastUserIndex);
    while (flattened.length > 1 && flattened[0].role === 'tool') flattened = flattened.slice(1);
    return flattened;
}

/** Chat transcript projection for GET /api/ai/conversations/[id]. */
export function projectConversation(events: AiEventRecord[]): AiConversationMessage[] {
    const messages: AiConversationMessage[] = [];
    let turn = 0;
    for (const record of sorted(events)) {
        const event = record.event;
        if (event.type === 'turn/start') {
            turn = event.turn;
            continue;
        }
        if (event.type === 'user/message') {
            messages.push({
                id: `event_${record.seq}`,
                role: 'user',
                turn,
                text: event.text,
                createdAt: record.created,
            });
            continue;
        }
        if (event.type === 'assistant/message') {
            messages.push({
                id: `event_${record.seq}`,
                role: 'assistant',
                turn,
                text: event.text,
                reasoning: event.reasoning,
                toolCalls: event.toolCalls.length > 0 ? event.toolCalls : undefined,
                createdAt: record.created,
            });
            continue;
        }
        if (event.type === 'tool/result') {
            messages.push({
                id: `event_${record.seq}`,
                role: 'tool',
                turn,
                toolResult: {
                    callId: event.callId,
                    name: event.name,
                    status: event.status,
                    summary: event.summary,
                    error: event.error,
                    durationMs: event.durationMs,
                },
                createdAt: record.created,
            });
            continue;
        }
        if (event.type === 'approval/decision') {
            messages.push({
                id: `event_${record.seq}`,
                role: 'system',
                kind: 'info',
                turn,
                text: `${event.approved ? 'Approved' : 'Denied'} ${event.name}${event.decidedBy ? ` by ${event.decidedBy}` : ''}`,
                createdAt: record.created,
            });
            continue;
        }
        if (event.type === 'turn/end' && event.status === 'error') {
            messages.push({
                id: `event_${record.seq}`,
                role: 'system',
                kind: 'error',
                turn,
                text: event.error || 'The turn failed.',
                createdAt: record.created,
            });
        }
    }
    return messages;
}

/** Status of the newest finished turn, used by the conversation list. */
export function lastTurnStatus(events: AiEventRecord[]): AiTurnStatus | 'idle' {
    let status: AiTurnStatus | 'idle' = 'idle';
    for (const record of sorted(events)) {
        if (record.event.type === 'turn/end') status = record.event.status;
    }
    return status;
}

/** Derive a short conversation title from the first user message. */
export function conversationTitleFromEvents(events: AiEventRecord[]): string | null {
    for (const record of sorted(events)) {
        if (record.event.type !== 'user/message') continue;
        const text = record.event.text.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        return text.length > 80 ? `${text.slice(0, 77)}…` : text;
    }
    return null;
}

/** Last assistant text, useful for "continue" style UI hints. */
export function lastAssistantText(events: AiEventRecord[]): string {
    let text = '';
    for (const record of sorted(events)) {
        if (record.event.type === 'assistant/message' && record.event.text) text = record.event.text;
    }
    return text;
}

/** Map a list of tool calls to a quick lookup for risk labels. */
export function riskLookupFromTools(
    tools: Array<{ name: string; risk: AiToolRisk }>
): (toolName: string) => AiToolRisk {
    const byName = new Map(tools.map((tool) => [tool.name, tool.risk]));
    return (toolName) => byName.get(toolName) ?? 'medium';
}

/** True when a given call id appears in an assistant message in the log. */
export function toolCallExists(events: AiEventRecord[], callId: string): boolean {
    for (const record of events) {
        if (record.event.type !== 'assistant/message') continue;
        if (record.event.toolCalls.some((call: AiToolCall) => call.id === callId)) return true;
    }
    return false;
}
