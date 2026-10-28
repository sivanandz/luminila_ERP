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
    getEnvironmentProvider,
    getProviderRow,
    providerFromInputForTest,
    rowToProvider,
    validateProviderInput,
} from '@/lib/ai/providers';
import { AiProviderError, listProviderModels } from '@/lib/ai/openai-compatible';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/ai/providers/models
 * Body: `{ id: string }` for a saved provider or `{ provider: AiProviderInput }`
 * for an unsaved one. Returns the provider's `GET /models` list for the picker.
 */
export async function POST(req: NextRequest) {
    const auth = await authenticateAiConfigRequest(req);
    if (!auth.ok) return auth.response;
    const forbidden = await requireAiAdmin(auth.context);
    if (forbidden) return forbidden;

    const parsed = await readJsonBody<{ id?: string; provider?: unknown }>(req);
    if (!parsed.ok) return parsed.response;

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
        } else if (parsed.body.provider !== undefined) {
            const input = validateProviderInput(parsed.body.provider);
            provider = await providerFromInputForTest(auth.context.adminClient, auth.context.accountEmail, input);
        } else {
            return jsonError(400, 'Provide a provider id or a provider object.', 'invalid_models_request');
        }

        const models = await listProviderModels(provider, { signal: AbortSignal.timeout(30_000) });
        return jsonOk({ models });
    } catch (error) {
        if (error instanceof AiConfigError) {
            return jsonError(error.code === 'provider_not_found' ? 404 : 400, error.message, error.code);
        }
        if (error instanceof AiProviderError) {
            return jsonError(502, error.message, error.code);
        }
        return jsonError(500, 'Could not list models from the provider.', 'models_failed');
    }
}
