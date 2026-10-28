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
    getProviderRow,
    markProviderTested,
    providerFromInputForTest,
    rowToProvider,
    validateProviderInput,
} from '@/lib/ai/providers';
import { testProviderConnection } from '@/lib/ai/openai-compatible';
import { getEnvironmentProvider } from '@/lib/ai/providers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function errorResponse(error: unknown) {
    if (error instanceof AiConfigError) {
        const status = error.code === 'provider_not_found' ? 404 : 400;
        return jsonError(status, error.message, error.code);
    }
    return jsonError(500, 'The connection test failed to run.', 'provider_test_failed');
}

/**
 * POST /api/ai/providers/test
 * Body: `{ id: string }` to test a saved provider, or `{ provider: AiProviderInput }`
 * to test an unsaved configuration (requires an API key).
 */
export async function POST(req: NextRequest) {
    const auth = await authenticateAiConfigRequest(req);
    if (!auth.ok) return auth.response;
    const forbidden = await requireAiAdmin(auth.context);
    if (forbidden) return forbidden;

    const parsed = await readJsonBody<{ id?: string; provider?: unknown }>(req);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body.id && parsed.body.provider === undefined) {
        return jsonError(400, 'Provide a provider id or a provider object.', 'invalid_provider_test');
    }

    try {
        let provider;
        if (parsed.body.id && parsed.body.provider === undefined) {
            if (parsed.body.id === 'environment') {
                const envProvider = getEnvironmentProvider();
                if (!envProvider) return jsonError(404, 'The environment provider is not configured.', 'provider_not_found');
                provider = envProvider;
            } else {
                const row = await getProviderRow(auth.context.adminClient, auth.context.accountEmail, parsed.body.id);
                provider = rowToProvider(row);
            }
        } else {
            const input = validateProviderInput(parsed.body.provider);
            provider = await providerFromInputForTest(auth.context.adminClient, auth.context.accountEmail, input);
        }

        const result = await testProviderConnection(provider);
        if (parsed.body.id && parsed.body.id !== 'environment') {
            await markProviderTested(auth.context.adminClient, parsed.body.id, result.ok);
        }
        return jsonOk({ ...result });
    } catch (error) {
        return errorResponse(error);
    }
}
