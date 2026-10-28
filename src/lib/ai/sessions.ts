/**
 * PocketBase persistence for the harness (server-only).
 *
 * The AI collections are server-owned: their API rules are null, so only the
 * server's superuser client can read or write them. Ownership is enforced here
 * by the tenant account email that the route derived from the verified
 * operator session — never from model input.
 */

import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import type {
    AiConversationDetail,
    AiConversationSummary,
    AiEvent,
    AiEventRecord,
    AiHarnessProfile,
    AiPendingApproval,
    AiToolRisk,
    AiTurnStatus,
} from './types';
import {
    conversationTitleFromEvents,
    getPendingApprovals,
    lastTurnStatus,
    projectConversation,
} from './events';

export const CONVERSATIONS_COLLECTION = 'ai_conversations';
export const EVENTS_COLLECTION = 'ai_events';
export const MAX_EVENTS_LOADED = 2_000;

function escapeFilter(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function accountClause(accountEmail: string): string {
    return `account_email="${escapeFilter(accountEmail)}"`;
}

function asText(value: unknown): string {
    return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function asStatus(value: unknown): AiTurnStatus | 'idle' {
    const status = asText(value);
    if (status === 'completed' || status === 'awaiting_approval' || status === 'error' || status === 'max_steps' || status === 'cancelled') {
        return status;
    }
    return 'idle';
}

function mapConversationRecord(record: RecordModel): AiConversationSummary {
    return {
        id: record.id,
        title: asText((record as Record<string, unknown>).title) || 'New conversation',
        profileId: asText((record as Record<string, unknown>).profile_id) || 'analyst',
        providerId: asText((record as Record<string, unknown>).provider_id),
        model: asText((record as Record<string, unknown>).model),
        status: asStatus((record as Record<string, unknown>).status),
        archived: (record as Record<string, unknown>).archived === true,
        lastMessageAt: asText((record as Record<string, unknown>).last_message_at) || undefined,
        created: record.created,
        updated: record.updated,
    };
}

function parsePayload(value: unknown): AiEvent | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') return value as AiEvent;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value) as AiEvent;
        } catch {
            return null;
        }
    }
    return null;
}

export interface CreateConversationInput {
    accountEmail: string;
    createdBy?: string;
    title: string;
    profileId: string;
    providerId: string;
    model: string;
}

export async function createConversation(
    client: PocketBase,
    input: CreateConversationInput
): Promise<AiConversationSummary> {
    const record = await client.collection(CONVERSATIONS_COLLECTION).create({
        account_email: input.accountEmail,
        created_by: input.createdBy || '',
        title: input.title,
        profile_id: input.profileId,
        provider_id: input.providerId,
        model: input.model,
        status: 'idle',
        archived: false,
        last_message_at: new Date().toISOString(),
    });
    return mapConversationRecord(record);
}

export async function listConversations(
    client: PocketBase,
    accountEmail: string,
    operatorEmail: string = accountEmail,
    limit = 40
): Promise<AiConversationSummary[]> {
    // Conversations are creator-scoped: a staff login must not list the owner's
    // transcripts (they may contain data their RBAC cannot read).
    const records = await client.collection(CONVERSATIONS_COLLECTION).getList(1, Math.min(100, Math.max(1, limit)), {
        filter: `${accountClause(accountEmail)} && created_by="${escapeFilter(operatorEmail)}" && archived = false`,
        sort: '-updated',
    });
    return records.items.map(mapConversationRecord);
}

export async function getConversation(
    client: PocketBase,
    accountEmail: string,
    conversationId: string,
    operatorEmail: string = accountEmail
): Promise<AiConversationSummary | null> {
    try {
        const record = await client.collection(CONVERSATIONS_COLLECTION).getOne(conversationId);
        const row = record as Record<string, unknown>;
        if (asText(row.account_email) !== accountEmail) return null;
        if (asText(row.created_by).trim().toLowerCase() !== operatorEmail.trim().toLowerCase()) return null;
        if (row.archived === true) return null;
        return mapConversationRecord(record);
    } catch (error) {
        const status = (error as { status?: number } | null)?.status;
        if (status === 404) return null;
        // A backend outage must not masquerade as "conversation not found".
        throw error;
    }
}

export async function updateConversation(
    client: PocketBase,
    conversationId: string,
    patch: Partial<{
        title: string;
        profileId: string;
        providerId: string;
        model: string;
        status: AiTurnStatus | 'idle';
        lastMessageAt: string;
    }>
): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (patch.title !== undefined) payload.title = patch.title;
    if (patch.profileId !== undefined) payload.profile_id = patch.profileId;
    if (patch.providerId !== undefined) payload.provider_id = patch.providerId;
    if (patch.model !== undefined) payload.model = patch.model;
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.lastMessageAt !== undefined) payload.last_message_at = patch.lastMessageAt;
    if (Object.keys(payload).length === 0) return;
    await client.collection(CONVERSATIONS_COLLECTION).update(conversationId, payload);
}

export async function archiveConversation(
    client: PocketBase,
    accountEmail: string,
    conversationId: string,
    operatorEmail: string = accountEmail
): Promise<boolean> {
    const conversation = await getConversation(client, accountEmail, conversationId, operatorEmail);
    if (!conversation) return false;
    await client.collection(CONVERSATIONS_COLLECTION).update(conversationId, { archived: true, status: 'idle' });
    return true;
}

export async function loadEvents(
    client: PocketBase,
    conversationId: string,
    accountEmail: string,
    operatorEmail: string = accountEmail
): Promise<AiEventRecord[]> {
    // Explicit pagination with a hard cap, newest-first so a very long
    // conversation keeps the tail that matters for approvals and context.
    const PAGE_SIZE = 500;
    const collected: RecordModel[] = [];
    for (let page = 1; collected.length < MAX_EVENTS_LOADED; page += 1) {
        const result = await client.collection(EVENTS_COLLECTION).getList(page, PAGE_SIZE, {
            filter: `conversation="${escapeFilter(conversationId)}" && ${accountClause(accountEmail)} && created_by="${escapeFilter(operatorEmail)}"`,
            sort: '-seq',
        });
        collected.push(...result.items);
        if (result.items.length < PAGE_SIZE || page * PAGE_SIZE >= result.totalItems) break;
    }
    const capped = collected.slice(0, MAX_EVENTS_LOADED);
    const events: AiEventRecord[] = [];
    for (const record of capped) {
        const payload = parsePayload((record as Record<string, unknown>).payload);
        if (!payload) continue;
        events.push({
            id: record.id,
            conversationId,
            seq: Number((record as Record<string, unknown>).seq) || 0,
            created: record.created,
            event: payload,
        });
    }
    events.sort((a, b) => a.seq - b.seq);
    return events;
}

export interface AppendEventInput {
    conversationId: string;
    accountEmail: string;
    createdBy?: string;
    seq: number;
    event: AiEvent;
}

export async function appendEvent(
    client: PocketBase,
    input: AppendEventInput
): Promise<AiEventRecord> {
    const event = input.event;
    const payload: Record<string, unknown> = {
        conversation: input.conversationId,
        account_email: input.accountEmail,
        created_by: input.createdBy || '',
        seq: input.seq,
        type: event.type,
        payload: event,
    };
    if (event.type === 'tool/result') {
        payload.tool_name = event.name;
        payload.tool_call_id = event.callId;
        payload.status = event.status;
        if (typeof event.durationMs === 'number') payload.duration_ms = event.durationMs;
    }
    if (event.type === 'approval/request') {
        payload.tool_name = event.name;
        payload.tool_call_id = event.callId;
    }
    const record = await client.collection(EVENTS_COLLECTION).create(payload);
    return {
        id: record.id,
        conversationId: input.conversationId,
        seq: input.seq,
        created: record.created,
        event,
    };
}

/** Next sequence number for a conversation (single writer per conversation). */
export async function nextSequenceForConversation(
    client: PocketBase,
    conversationId: string,
    accountEmail: string,
    loadedEvents?: AiEventRecord[]
): Promise<number> {
    if (loadedEvents && loadedEvents.length > 0) {
        return Math.max(...loadedEvents.map((event) => event.seq)) + 1;
    }
    const records = await client.collection(EVENTS_COLLECTION).getList(1, 1, {
        filter: `conversation="${escapeFilter(conversationId)}" && ${accountClause(accountEmail)}`,
        sort: '-seq',
    });
    if (records.items.length === 0) return 1;
    return Number((records.items[0] as Record<string, unknown>).seq) + 1;
}

/** Full transcript projection for GET /api/ai/conversations/[id]. */
export function buildConversationDetail(
    conversation: AiConversationSummary,
    events: AiEventRecord[],
    riskFor: (toolName: string) => AiToolRisk
): AiConversationDetail {
    const pendingApprovals: AiPendingApproval[] = getPendingApprovals(events, riskFor);
    return {
        conversation: {
            ...conversation,
            title: conversation.title || conversationTitleFromEvents(events) || 'New conversation',
            status: lastTurnStatus(events),
        },
        messages: projectConversation(events),
        pendingApprovals,
    };
}

/** Risk lookup from a harness profile's visible tools. */
export function riskLookup(
    tools: Array<{ name: string; risk: AiToolRisk }>
): (toolName: string) => AiToolRisk {
    const map = new Map(tools.map((tool) => [tool.name, tool.risk]));
    return (toolName) => map.get(toolName) ?? 'medium';
}

export type { AiHarnessProfile };
