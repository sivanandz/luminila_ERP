import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    acquireConversationLock,
    authenticateAiRequest,
    jsonError,
    readJsonBody,
    releaseConversationLock,
} from '@/lib/ai/http';
import { AiConfigError, resolveProviderForRequest } from '@/lib/ai/providers';
import { getHarnessProfile } from '@/lib/ai/harness';
import { buildSystemPrompt, type StorePromptContext } from '@/lib/ai/prompt';
import { conversationTitleFromEvents } from '@/lib/ai/events';
import {
    appendEvent as persistEvent,
    createConversation,
    getConversation,
    loadEvents,
    updateConversation,
} from '@/lib/ai/sessions';
import { createToolRuntimes, toProviderToolSpecs, toolsForProfile, type AiTool } from '@/lib/ai/tools/registry';
import { startTurnStream } from '@/lib/ai/chat-stream';
import type { Resource, Permission } from '@/lib/rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const chatBodySchema = z
    .object({
        conversationId: z.string().trim().min(1).max(40).optional(),
        message: z.string().trim().min(1).max(8_000).optional(),
        approvals: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
        profileId: z.string().trim().min(1).max(40).optional(),
        providerId: z.string().trim().min(1).max(40).optional(),
    })
    .refine((value) => (value.message ? value.approvals === undefined : value.approvals !== undefined), {
        message: 'Provide either a message or an approvals list, not both.',
    });

function escapeFilter(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Display-safe store context for the system prompt. Missing settings never fail
 * the turn: the prompt simply carries the defaults.
 */
async function loadStoreContext(
    client: import('pocketbase').default,
    accountEmail: string
): Promise<StorePromptContext> {
    const fallback: StorePromptContext = { storeName: 'Luminila', currency: 'INR' };
    try {
        const record = await client
            .collection('store_settings')
            .getFirstListItem(`category="store_config" && account_email="${escapeFilter(accountEmail)}"`, {
                sort: '-updated',
            });
        const raw = (record as Record<string, unknown>).value;
        const value = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
        if (!value || typeof value !== 'object') return fallback;
        const threshold = Number(value.lowStockThreshold);
        return {
            storeName: typeof value.storeName === 'string' && value.storeName.trim() ? value.storeName.trim() : fallback.storeName,
            currency: typeof value.currency === 'string' && value.currency.trim() ? value.currency.trim() : 'INR',
            gstin: typeof value.gstin === 'string' ? value.gstin : undefined,
            city: typeof value.city === 'string' ? value.city : undefined,
            state: typeof value.state === 'string' ? value.state : undefined,
            lowStockThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 5,
        };
    } catch {
        return fallback;
    }
}

/**
 * POST /api/ai/chat — run one agent turn and stream its events.
 *
 * Body: `{ conversationId?, message?, approvals?, profileId?, providerId? }`
 * - `message` starts a turn (a new conversation is created when no id is sent).
 * - `approvals` resumes a turn paused at write-tool approval; only call ids
 *   that are genuinely pending in this conversation can be approved.
 */
export async function POST(req: NextRequest) {
    const auth = await authenticateAiRequest(req);
    if (!auth.ok) return auth.response;
    const { context } = auth;

    const parsedBody = await readJsonBody<unknown>(req);
    if (!parsedBody.ok) return parsedBody.response;
    const bodyResult = chatBodySchema.safeParse(parsedBody.body);
    if (!bodyResult.success) {
        const issue = bodyResult.error.issues[0];
        return jsonError(400, issue?.message ?? 'Invalid chat request.', 'invalid_request');
    }
    const body = bodyResult.data;

    // Load the conversation (if any) before resolving the provider/profile: a
    // resume must continue with the provider and harness profile the turn was
    // paused under, not whatever the client omitted or switched to.
    let conversation: Awaited<ReturnType<typeof getConversation>> = null;
    if (body.conversationId) {
        try {
            conversation = await getConversation(
                context.adminClient,
                context.accountEmail,
                body.conversationId,
                context.operatorEmail
            );
        } catch (error) {
            return jsonError(
                503,
                error instanceof Error ? error.message : 'Conversation storage is unavailable.',
                'conversation_storage_failed'
            );
        }
        if (!conversation) return jsonError(404, 'Conversation not found.', 'conversation_not_found');
    }

    // Resolve the provider: explicit request > conversation > tenant default.
    // An unconfigured install must not create conversation records or open a stream.
    let provider;
    try {
        provider = await resolveProviderForRequest(
            context.adminClient,
            context.accountEmail,
            body.providerId || conversation?.providerId || undefined
        );
    } catch (error) {
        if (error instanceof AiConfigError) {
            const status = error.code === 'not_configured' ? 503 : error.code === 'provider_not_found' ? 404 : 400;
            return jsonError(status, error.message, error.code);
        }
        return jsonError(500, 'Could not resolve the AI provider.', 'provider_resolution_failed');
    }

    let conversationId: string;
    let conversationTitle: string;
    try {
        if (conversation) {
            conversationId = conversation.id;
            conversationTitle = conversation.title;
        } else {
            const created = await createConversation(context.adminClient, {
                accountEmail: context.accountEmail,
                createdBy: context.operatorEmail,
                title: 'New conversation',
                profileId: body.profileId ?? 'analyst',
                providerId: provider.provider.id,
                model: provider.provider.model,
            });
            conversationId = created.id;
            conversationTitle = created.title;
        }
    } catch (error) {
        return jsonError(
            503,
            error instanceof Error ? error.message : 'Conversation storage is unavailable.',
            'conversation_storage_failed'
        );
    }

    if (!acquireConversationLock(conversationId)) {
        return jsonError(409, 'A turn is already running in this conversation.', 'conversation_busy');
    }

    try {
        // Resume/approval turns inherit the persisted profile; only a turn that
        // explicitly switches profile can change it.
        const profile = getHarnessProfile(body.profileId ?? conversation?.profileId ?? undefined);
        const events = await loadEvents(
            context.adminClient,
            conversationId,
            context.accountEmail,
            context.operatorEmail
        );

        const allProfileTools = toolsForProfile(profile);
        const visibleTools: AiTool[] = [];
        for (const tool of allProfileTools) {
            if (!tool.capability) {
                visibleTools.push(tool);
                continue;
            }
            const granted = await context.capabilities.has(
                tool.capability.resource as Resource,
                tool.capability.action as Permission
            );
            if (granted) visibleTools.push(tool);
        }

        const now = new Date();
        // Tools run on the tenant admin client with the tenant scope + RBAC
        // enforced in code (N-01): PB's per-row account_email rules would make a
        // staff token unable to read the owner's rows at all. The capability gate
        // above is the authorization boundary, and every filter still carries the
        // session-derived account email.
        const toolRuntimes = createToolRuntimes(visibleTools, {
            client: context.adminClient,
            accountEmail: context.accountEmail,
            conversationId,
            sessionEmail: context.operatorEmail,
            userId: context.userId,
            now,
        });
        const providerTools = toProviderToolSpecs(visibleTools);
        const storeContext = await loadStoreContext(context.adminClient, context.accountEmail);
        const systemPrompt = buildSystemPrompt({
            store: storeContext,
            profile,
            tools: visibleTools.map((tool) => ({
                name: tool.name,
                title: tool.title,
                kind: tool.kind,
                description: tool.description,
            })),
            operator: {
                email: context.operatorEmail,
                roleName: context.capabilities.isAdmin ? 'Administrator' : 'Staff',
            },
            now,
        });

        return startTurnStream({
            requestSignal: req.signal,
            conversationId,
            provider: provider.provider,
            profile,
            systemPrompt,
            history: events,
            tools: toolRuntimes,
            providerTools,
            message: body.message,
            approvals: body.approvals,
            actorEmail: context.operatorEmail,
            sessionId: conversationId,
            appendEvent: async (event, seq) => {
                return persistEvent(context.adminClient, {
                    conversationId,
                    accountEmail: context.accountEmail,
                    createdBy: context.operatorEmail,
                    seq,
                    event,
                });
            },
            capabilityCheck: async (tool) => {
                if (!tool.capability) return true;
                return context.capabilities.has(
                    tool.capability.resource as Resource,
                    tool.capability.action as Permission
                );
            },
            onFinished: async (status, finalEvents) => {
                await updateConversation(context.adminClient, conversationId, {
                    status,
                    lastMessageAt: new Date().toISOString(),
                    title:
                        conversationTitle && conversationTitle !== 'New conversation'
                            ? conversationTitle
                            : conversationTitleFromEvents(finalEvents) || conversationTitle,
                    profileId: profile.id,
                    providerId: provider.provider.id,
                    model: provider.provider.model,
                });
            },
            releaseLock: () => releaseConversationLock(conversationId),
        });
    } catch (error) {
        releaseConversationLock(conversationId);
        return jsonError(
            500,
            error instanceof Error ? error.message : 'The AI turn could not start.',
            'turn_start_failed'
        );
    }
}
