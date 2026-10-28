import type { NextRequest } from 'next/server';
import { authenticateAiReadRequest, jsonError, jsonOk, AI_CHAT_REQUESTS_PER_MINUTE } from '@/lib/ai/http';
import { describeTools } from '@/lib/ai/tools/registry';
import { getHarnessProfile, listHarnessProfiles } from '@/lib/ai/harness';
import { listPublicProviders, getEnvironmentProvider, resolveProviderForRequest } from '@/lib/ai/providers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/ai/status
 *
 * Any authenticated operator may read the AI status: whether a provider is
 * configured, which profiles exist, and which tools their role can use. No key
 * material or provider ciphertext is exposed.
 */
export async function GET(req: NextRequest) {
    const auth = await authenticateAiReadRequest(req);
    if (!auth.ok) return auth.response;
    const { context } = auth;

    let providers: Awaited<ReturnType<typeof listPublicProviders>> = [];
    let providerError: string | undefined;
    try {
        providers = await listPublicProviders(context.adminClient, context.accountEmail);
    } catch (error) {
        providerError = error instanceof Error ? error.message : 'Provider settings could not be read.';
    }
    const envProvider = getEnvironmentProvider();
    let configured = providers.some((provider) => provider.enabled) || Boolean(envProvider);
    if (!configured && !providerError) {
        try {
            await resolveProviderForRequest(context.adminClient, context.accountEmail);
            configured = true;
        } catch {
            configured = false;
        }
    }

    // Only advertise tools the operator's role actually grants. The model never
    // sees a tool its operator cannot run, so the status surface mirrors that.
    const roleVisibleTools: ReturnType<typeof describeTools> = [];
    for (const tool of describeTools()) {
        if (!tool.capability) {
            roleVisibleTools.push(tool);
            continue;
        }
        const granted = await context.capabilities.has(
            tool.capability.resource as Parameters<typeof context.capabilities.has>[0],
            tool.capability.action as Parameters<typeof context.capabilities.has>[1]
        );
        if (granted) roleVisibleTools.push(tool);
    }

    const defaultProfile = getHarnessProfile(undefined);
    return jsonOk({
        configured,
        providerError,
        providers: providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            model: provider.model,
            isDefault: provider.isDefault,
            source: provider.source,
        })),
        profiles: listHarnessProfiles().map((profile) => ({
            id: profile.id,
            name: profile.name,
            description: profile.description,
            allowWrites: profile.allowWrites,
        })),
        tools: roleVisibleTools.map(({ name, title, kind, capability }) => ({ name, title, kind, capability })),
        visibleToolCount: roleVisibleTools.length,
        limits: {
            maxSteps: defaultProfile.maxSteps,
            maxToolCallsPerStep: defaultProfile.maxToolCallsPerStep,
            requestsPerMinute: AI_CHAT_REQUESTS_PER_MINUTE,
        },
    });
}

export function OPTIONS() {
    return jsonError(405, 'Method not allowed.', 'method_not_allowed');
}
