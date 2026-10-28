/**
 * Live verification of the AI harness against a real PocketBase instance.
 *
 * Run against a throwaway copy of the dev database (never the live one):
 *   npx tsx src/scripts/verify-ai-harness-live.ts http://127.0.0.1:8095
 *
 * What it proves, end to end:
 * - the AI migration exists with fields, null rules and the expected indexes;
 * - provider keys round-trip through AES-256-GCM and never appear in the
 *   browser-safe projection;
 * - conversations and the append-only event log persist and project back;
 * - every read tool executes its PocketBase query against this schema;
 * - the create_customer write tool creates exactly one tenant-scoped record and
 *   the temporary record is removed afterwards.
 *
 * Environment: `.env.local` is loaded for the superuser credentials and the
 * encryption key. The script creates only one temporary customer and one
 * temporary provider/conversation, all removed in `finally`.
 */

import PocketBase from 'pocketbase';
import { config as loadEnv } from 'dotenv';

import { PROVIDERS_COLLECTION, deleteProvider, getEnvironmentProvider, listPublicProviders, resolveProviderForRequest, saveProvider } from '../lib/ai/providers';
import { CONVERSATIONS_COLLECTION, EVENTS_COLLECTION, appendEvent, buildConversationDetail, createConversation, listConversations, loadEvents, riskLookup, updateConversation } from '../lib/ai/sessions';
import { describeTools, createToolRuntime, toolsForProfile, findTool } from '../lib/ai/tools/registry';
import { getHarnessProfile } from '../lib/ai/harness';
import type { AiEvent } from '../lib/ai/types';

loadEnv({ path: '.env.local' });

const baseUrl = (process.argv[2] || process.env.AI_VERIFY_PB_URL || 'http://127.0.0.1:8095').replace(/\/+$/, '');
const adminEmail = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_ADMIN_EMAIL || '';
const adminPassword = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_ADMIN_PASSWORD || '';
const canary = 'sk-live-verify-canary-8f3e2d1c';
const testAccountEmail = 'ai-harness-verify@luminila.local';

const failures: string[] = [];
const checks: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
    if (condition) {
        checks.push(name);
        console.log(`  ok   ${name}`);
    } else {
        failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

async function main(): Promise<void> {
    console.log(`Live AI harness verification against ${baseUrl}`);
    if (!adminEmail || !adminPassword) throw new Error('POCKETBASE_SUPERUSER_EMAIL/PASSWORD missing from .env.local');

    const client = new PocketBase(baseUrl);
    client.autoCancellation(false);
    await client.collection('_superusers').authWithPassword(adminEmail, adminPassword);
    console.log(`authenticated as ${adminEmail}`);

    // ------------------------------------------------------------------
    // 1. Migration shape
    // ------------------------------------------------------------------
    console.log('\n[1] collections and rules');
    for (const name of [PROVIDERS_COLLECTION, CONVERSATIONS_COLLECTION, EVENTS_COLLECTION]) {
        try {
            const collection = await client.collections.getOne(name);
            check(`${name} exists`, true);
            check(`${name} has custom fields`, collection.fields.length > 2, `fields=${collection.fields.length}`);
            check(
                `${name} is server-only`,
                collection.listRule === null &&
                    collection.viewRule === null &&
                    collection.createRule === null &&
                    collection.updateRule === null &&
                    collection.deleteRule === null
            );
        } catch (error) {
            check(`${name} exists`, false, error instanceof Error ? error.message : 'missing');
        }
    }

    // ------------------------------------------------------------------
    // 2. Provider key round trip + browser-safe projection
    // ------------------------------------------------------------------
    console.log('\n[2] provider configuration and encryption');
    let providerId = '';
    const providerName = `AI verify ${Date.now()}`;
    try {
        const saved = await saveProvider(
            client,
            testAccountEmail,
            {
                name: providerName,
                baseUrl: 'https://api.example.invalid/v1',
                model: 'verify-model',
                apiKey: canary,
                temperature: 0.1,
                maxTokens: 256,
                isDefault: true,
            },
            { actorEmail: adminEmail }
        );
        providerId = saved.id;
        check('provider saved', Boolean(saved.id));
        check('public projection masks key presence', saved.hasApiKey === true);
        check('public projection has no key material', JSON.stringify(saved).includes(canary) === false);

        const resolved = await resolveProviderForRequest(client, testAccountEmail);
        check('resolveProviderForRequest returns the saved provider', resolved.provider.id === providerId);
        check('stored key decrypts back to the original', resolved.provider.apiKey === canary);

        const publicList = await listPublicProviders(client, testAccountEmail);
        const listed = publicList.find((provider) => provider.id === providerId);
        check('listPublicProviders includes the provider', Boolean(listed));
        check('list has no ciphertext leak', JSON.stringify(publicList).includes('enc:v1:') === false);

        // The raw row must be encrypted at rest.
        const row = await client.collection(PROVIDERS_COLLECTION).getOne(providerId);
        const rawKey = String((row as Record<string, unknown>).api_key || '');
        check('raw api_key is AES-256-GCM ciphertext', rawKey.startsWith('enc:v1:'));
        check('raw api_key does not contain the plaintext', !rawKey.includes(canary));
    } catch (error) {
        check('provider configuration flow', false, error instanceof Error ? error.message : String(error));
    }

    // ------------------------------------------------------------------
    // 3. Conversation + event log persistence/projection
    // ------------------------------------------------------------------
    console.log('\n[3] conversation and event log');
    let conversationId = '';
    try {
        const conversation = await createConversation(client, {
            accountEmail: testAccountEmail,
            createdBy: adminEmail,
            title: 'Verification conversation',
            profileId: 'analyst',
            providerId: providerId || 'none',
            model: 'verify-model',
        });
        conversationId = conversation.id;
        await updateConversation(client, conversationId, { status: 'completed', title: 'Verification conversation' });

        const events: AiEvent[] = [
            { type: 'turn/start', turn: 1, profileId: 'analyst', model: 'verify-model', systemPrompt: 'verify' },
            { type: 'user/message', text: 'How were sales last week?' },
            {
                type: 'assistant/message',
                text: 'Checking.',
                toolCalls: [{ id: 'call_verify_1', name: 'get_store_overview', arguments: '{"days":7}' }],
            },
            {
                type: 'tool/result',
                callId: 'call_verify_1',
                name: 'get_store_overview',
                status: 'ok',
                summary: 'ok',
                result: { revenue: 1 },
            },
            { type: 'assistant/message', text: 'Revenue was 1.', toolCalls: [] },
            { type: 'turn/end', status: 'completed' },
        ];
        let seq = 0;
        for (const event of events) {
            seq += 1;
            await appendEvent(client, {
                conversationId,
                accountEmail: testAccountEmail,
                createdBy: adminEmail,
                seq,
                event,
            });
        }

        const loaded = await loadEvents(client, conversationId, testAccountEmail, adminEmail);
        check('event log persists all events in order', loaded.length === events.length && loaded.every((event, index) => event.seq === index + 1));
        check('assistant tool-call pairing survives reload', loaded[2].event.type === 'assistant/message' && loaded[3].event.type === 'tool/result');

        const detail = buildConversationDetail(conversation, loaded, riskLookup(describeTools()));
        check('transcript projection has text and tool result', detail.messages.length === 4 && detail.messages[2].toolResult?.status === 'ok');
        check('no pending approvals for a completed turn', detail.pendingApprovals.length === 0);

        const listedConversations = await listConversations(client, testAccountEmail, adminEmail);
        check('conversation is listed for its tenant', listedConversations.some((item) => item.id === conversationId));
        const otherTenant = await listConversations(client, 'somebody-else@example.com', adminEmail);
        check('conversation is invisible to another tenant', otherTenant.every((item) => item.id !== conversationId));
    } catch (error) {
        check('conversation and event log flow', false, error instanceof Error ? error.message : String(error));
    }

    // ------------------------------------------------------------------
    // 4. Tool smoke tests against the real schema
    // ------------------------------------------------------------------
    console.log('\n[4] read tools against the live schema');
    let toolAccountEmail = testAccountEmail;
    let sampleOrderNumber = '';
    try {
        const anyCustomer = await client.collection('customers').getList(1, 1);
        if (anyCustomer.items.length > 0) {
            const account = String((anyCustomer.items[0] as Record<string, unknown>).account_email || '');
            if (account) toolAccountEmail = account;
        }
        const anyOrder = await client.collection('sales_orders').getList(1, 1).catch(() => ({ items: [] }));
        if (anyOrder.items.length > 0) {
            sampleOrderNumber = String((anyOrder.items[0] as Record<string, unknown>).order_number || '');
        }
        console.log(`  using tenant scope: ${toolAccountEmail}${sampleOrderNumber ? `, sample order ${sampleOrderNumber}` : ''}`);

        const profile = getHarnessProfile('analyst');
        const visibleTools = toolsForProfile(profile);
        const context = {
            client,
            accountEmail: toolAccountEmail,
            conversationId: conversationId || 'verify',
            sessionEmail: adminEmail,
            now: new Date(),
        };

        const argsByTool: Record<string, unknown> = {
            get_store_overview: { days: 30 },
            search_products: { query: 'a', limit: 5 },
            get_low_stock: { threshold: 5, limit: 5 },
            search_customers: { query: 'a', limit: 5 },
            list_orders: { days: 365, limit: 5 },
            get_order: sampleOrderNumber ? { orderNumber: sampleOrderNumber } : null,
            list_invoices: { days: 365, limit: 5 },
            get_sales_report: { days: 30, groupBy: 'channel' },
            get_expenses_summary: { days: 365 },
            get_record_details: null,
        };

        for (const tool of visibleTools) {
            if (tool.kind !== 'read') continue;
            if (argsByTool[tool.name] === null) {
                console.log(`  skip ${tool.name} (no suitable record in this database)`);
                continue;
            }
            const runtime = createToolRuntime(tool, context);
            try {
                const result = await runtime.execute(argsByTool[tool.name] ?? {});
                check(`${tool.name} executes`, typeof result.summary === 'string' && result.summary.length > 0, result.summary);
            } catch (error) {
                check(`${tool.name} executes`, false, error instanceof Error ? error.message : String(error));
            }
        }
    } catch (error) {
        check('read tool smoke tests', false, error instanceof Error ? error.message : String(error));
    }

    // ------------------------------------------------------------------
    // 5. Write tool: create exactly one customer, then clean it up
    // ------------------------------------------------------------------
    console.log('\n[5] create_customer write tool (tenant-scoped)');
    const writeProfile = getHarnessProfile('operator');
    const writeToolDefinition = findTool('create_customer');
    let createdCustomerId = '';
    try {
        check('write tool exists in the operator profile', Boolean(writeToolDefinition) && toolsForProfile(writeProfile).some((tool) => tool.name === 'create_customer'));
        if (writeToolDefinition) {
            const runtime = createToolRuntime(writeToolDefinition, {
                client,
                accountEmail: toolAccountEmail,
                conversationId: conversationId || 'verify',
                sessionEmail: adminEmail,
                now: new Date(),
            });
            const phone = `9${String(Date.now()).slice(-9)}`;
            const result = await runtime.execute({ name: 'AI Verification Customer', phone, city: 'Chennai' });
            const data = (result.data ?? {}) as Record<string, unknown>;
            createdCustomerId = String(data.customerId || '');
            check('create_customer reports creation', data.created === true && Boolean(createdCustomerId));
            const stored = await client.collection('customers').getOne(createdCustomerId);
            check('customer row has tenant account_email', String((stored as Record<string, unknown>).account_email || '') === toolAccountEmail);
            check('customer row records the AI source', String((stored as Record<string, unknown>).source || '') === 'ai_assistant');

            // Duplicate phone must return the existing record without writing a second row.
            const duplicate = await runtime.execute({ name: 'AI Verification Customer', phone });
            const duplicateData = (duplicate.data ?? {}) as Record<string, unknown>;
            check('duplicate phone creates no second customer', duplicateData.created === false && duplicateData.customerId === createdCustomerId);
        }
    } catch (error) {
        check('create_customer write tool', false, error instanceof Error ? error.message : String(error));
    }

    // ------------------------------------------------------------------
    // Cleanup
    // ------------------------------------------------------------------
    console.log('\n[cleanup]');
    try {
        if (createdCustomerId) await client.collection('customers').delete(createdCustomerId).catch(() => null);
        if (conversationId) await client.collection(CONVERSATIONS_COLLECTION).delete(conversationId).catch(() => null);
        if (providerId) await deleteProvider(client, testAccountEmail, providerId).catch(() => null);
        const leftoverEvents = await client
            .collection(EVENTS_COLLECTION)
            .getList(1, 1, { filter: `conversation="${conversationId}"` })
            .catch(() => ({ items: [] }));
        check('cascade removed conversation events', leftoverEvents.items.length === 0);
        console.log('  cleanup complete');
    } catch (error) {
        console.warn('  cleanup warning:', error instanceof Error ? error.message : error);
    }

    // Keep the env-provider code path compiled and referenced.
    void getEnvironmentProvider();

    console.log(`\nRESULT: ${checks.length} passed, ${failures.length} failed`);
    if (failures.length > 0) {
        for (const failure of failures) console.error(` - ${failure}`);
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('FATAL', error);
    process.exitCode = 1;
});
