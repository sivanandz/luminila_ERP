import type { NextRequest } from 'next/server';
import {
    authenticateAiConfigRequest,
    requireAiAdmin,
    jsonError,
    jsonOk,
    readJsonBody,
} from '@/lib/ai/http';
import {
    AiConfigError,
    deleteProvider,
    listPublicProviders,
    saveProvider,
    validateProviderInput,
} from '@/lib/ai/providers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function configErrorResponse(error: unknown) {
    if (error instanceof AiConfigError) {
        const status = error.code === 'provider_not_found' ? 404 : error.code === 'missing_secret_key' ? 503 : 400;
        return jsonError(status, error.message, error.code);
    }
    return jsonError(500, 'The provider settings request failed.', 'provider_settings_failed');
}

/** GET /api/ai/providers — admin-only, browser-safe provider list. */
export async function GET(req: NextRequest) {
    const auth = await authenticateAiConfigRequest(req);
    if (!auth.ok) return auth.response;
    const forbidden = await requireAiAdmin(auth.context);
    if (forbidden) return forbidden;
    try {
        const providers = await listPublicProviders(auth.context.adminClient, auth.context.accountEmail);
        return jsonOk({ providers });
    } catch (error) {
        return configErrorResponse(error);
    }
}

/**
 * POST /api/ai/providers — create or update a provider.
 * Body: `{ id?: string, provider: AiProviderInput }`
 */
export async function POST(req: NextRequest) {
    const auth = await authenticateAiConfigRequest(req);
    if (!auth.ok) return auth.response;
    const forbidden = await requireAiAdmin(auth.context);
    if (forbidden) return forbidden;

    const parsed = await readJsonBody<{ id?: string; provider?: unknown }>(req);
    if (!parsed.ok) return parsed.response;
    if (parsed.body.provider === undefined) {
        return jsonError(400, 'A provider object is required.', 'invalid_provider');
    }
    try {
        const input = validateProviderInput(parsed.body.provider);
        const provider = await saveProvider(auth.context.adminClient, auth.context.accountEmail, input, {
            providerId: parsed.body.id,
            actorEmail: auth.context.operatorEmail,
        });
        return jsonOk({ provider });
    } catch (error) {
        return configErrorResponse(error);
    }
}

/** DELETE /api/ai/providers?id=... — admin-only. */
export async function DELETE(req: NextRequest) {
    const auth = await authenticateAiConfigRequest(req);
    if (!auth.ok) return auth.response;
    const forbidden = await requireAiAdmin(auth.context);
    if (forbidden) return forbidden;

    const id = (req.nextUrl.searchParams.get('id') || '').trim();
    if (!id) return jsonError(400, 'A provider id is required.', 'invalid_provider_id');
    try {
        await deleteProvider(auth.context.adminClient, auth.context.accountEmail, id);
        return jsonOk({ deleted: true });
    } catch (error) {
        return configErrorResponse(error);
    }
}
