import type { NextRequest } from 'next/server';
import { authenticateAiReadRequest, jsonError, jsonOk } from '@/lib/ai/http';
import { buildConversationDetail, archiveConversation, getConversation, loadEvents, riskLookup } from '@/lib/ai/sessions';
import { describeTools } from '@/lib/ai/tools/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
    params: Promise<{ id: string }>;
}

/** GET /api/ai/conversations/[id] — transcript plus pending approvals. */
export async function GET(req: NextRequest, routeContext: RouteContext) {
    const auth = await authenticateAiReadRequest(req);
    if (!auth.ok) return auth.response;
    const { id } = await routeContext.params;
    if (!id) return jsonError(400, 'Conversation id is required.', 'invalid_conversation_id');

    let conversation: Awaited<ReturnType<typeof getConversation>> = null;
    let events: Awaited<ReturnType<typeof loadEvents>> = [];
    try {
        conversation = await getConversation(
            auth.context.adminClient,
            auth.context.accountEmail,
            id,
            auth.context.operatorEmail
        );
        if (conversation) {
            events = await loadEvents(
                auth.context.adminClient,
                id,
                auth.context.accountEmail,
                auth.context.operatorEmail
            );
        }
    } catch (error) {
        return jsonError(
            503,
            error instanceof Error ? error.message : 'Conversation storage is unavailable.',
            'conversation_storage_failed'
        );
    }
    if (!conversation) return jsonError(404, 'Conversation not found.', 'conversation_not_found');

    const detail = buildConversationDetail(conversation, events, riskLookup(describeTools()));
    return jsonOk({ ...detail });
}

/** DELETE /api/ai/conversations/[id] — archive (soft delete, audit preserved). */
export async function DELETE(req: NextRequest, routeContext: RouteContext) {
    const auth = await authenticateAiReadRequest(req);
    if (!auth.ok) return auth.response;
    const { id } = await routeContext.params;
    if (!id) return jsonError(400, 'Conversation id is required.', 'invalid_conversation_id');
    try {
        const archived = await archiveConversation(
            auth.context.adminClient,
            auth.context.accountEmail,
            id,
            auth.context.operatorEmail
        );
        if (!archived) return jsonError(404, 'Conversation not found.', 'conversation_not_found');
        return jsonOk({ archived: true });
    } catch (error) {
        return jsonError(
            503,
            error instanceof Error ? error.message : 'Conversation storage is unavailable.',
            'conversation_storage_failed'
        );
    }
}
