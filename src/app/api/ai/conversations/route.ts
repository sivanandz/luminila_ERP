import type { NextRequest } from 'next/server';
import { authenticateAiReadRequest, jsonError, jsonOk } from '@/lib/ai/http';
import { listConversations } from '@/lib/ai/sessions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/ai/conversations — this tenant's recent conversations. */
export async function GET(req: NextRequest) {
    const auth = await authenticateAiReadRequest(req);
    if (!auth.ok) return auth.response;
    try {
        const conversations = await listConversations(
            auth.context.adminClient,
            auth.context.accountEmail,
            auth.context.operatorEmail,
            40
        );
        return jsonOk({ conversations });
    } catch (error) {
        return jsonError(503, error instanceof Error ? error.message : 'Conversation storage is unavailable.', 'conversation_storage_failed');
    }
}
