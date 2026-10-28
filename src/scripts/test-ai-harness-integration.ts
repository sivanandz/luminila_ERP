/**
 * Integration tests for the agent loop against a real OpenAI-compatible HTTP
 * endpoint (a local fake provider), including streaming fragmentation,
 * approval-gated write tools, denial, provider tool fallback, cancellation,
 * max-step budgets and excess tool-call limits.
 *
 * Run: npx tsx src/scripts/test-ai-harness-integration.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';

import { runAgentTurn, type RunAgentTurnOptions } from '../lib/ai/agent-loop';
import { getHarnessProfile } from '../lib/ai/harness';
import {
    deriveModelHistory,
    getPendingToolCalls,
    projectConversation,
} from '../lib/ai/events';
import type {
    AiEvent,
    AiEventRecord,
    AiProviderConfig,
    AiProviderToolSpec,
    AiStreamEvent,
    AgentToolRuntime,
} from '../lib/ai/types';

interface FakeProvider {
    baseUrl: string;
    calls: Array<Record<string, unknown>>;
    close: () => Promise<void>;
}

type Handler = (callIndex: number, body: Record<string, unknown>, res: http.ServerResponse) => Promise<void> | void;

async function startFakeProvider(handler: Handler): Promise<FakeProvider> {
    const calls: Array<Record<string, unknown>> = [];
    const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
            const callIndex = calls.length;
            let body: Record<string, unknown> = {};
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
            } catch {
                body = {};
            }
            calls.push(body);
            try {
                await handler(callIndex, body, res);
            } catch {
                try {
                    res.destroy();
                } catch {
                    // Client already gone.
                }
            }
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        calls,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}

function sseHead(res: http.ServerResponse): void {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
}

function frame(payload: unknown): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentFrame(text: string): string {
    return frame({ choices: [{ delta: { content: text } }] });
}

function toolCallFrame(id: string, name: string, argsChunk: string, index = 0, first = true): string {
    return frame({
        choices: [
            {
                delta: {
                    tool_calls: [
                        {
                            index,
                            ...(first ? { id, function: { name, arguments: argsChunk } } : { function: { arguments: argsChunk } }),
                        },
                    ],
                },
            },
        ],
    });
}

/** Write a string byte-by-byte so UTF-8 sequences and SSE frames split. */
async function writeFragmented(res: http.ServerResponse, text: string): Promise<void> {
    const bytes = Buffer.from(text, 'utf8');
    for (const byte of bytes) {
        if (res.destroyed) return;
        res.write(Buffer.from([byte]));
    }
}

async function writeSse(res: http.ServerResponse, chunks: string[]): Promise<void> {
    sseHead(res);
    for (const chunk of chunks) {
        if (res.destroyed) return;
        res.write(chunk);
    }
    res.end();
}

function makeProvider(baseUrl: string): AiProviderConfig {
    return {
        id: 'fake',
        name: 'Fake provider',
        baseUrl,
        apiKey: 'sk-fake-test-key',
        model: 'fake-model',
        models: [],
        customHeaders: {},
        temperature: 0.1,
        maxTokens: 512,
        maxTokensParam: 'max_tokens',
        supportsTools: true,
        enabled: true,
        isDefault: true,
        timeoutMs: 10_000,
        source: 'database',
    };
}

interface Harness {
    events: AiEventRecord[];
    emitted: AiStreamEvent[];
    appendEvent: (event: AiEvent) => Promise<AiEventRecord>;
}

function createHarness(initial: AiEventRecord[] = []): Harness {
    const events: AiEventRecord[] = [...initial];
    const emitted: AiStreamEvent[] = [];
    let seq = events.reduce((max, record) => Math.max(max, record.seq), 0);
    return {
        events,
        emitted,
        appendEvent: async (event) => {
            seq += 1;
            const record: AiEventRecord = { id: `evt_${seq}`, conversationId: 'conv_test', seq, event };
            events.push(record);
            return record;
        },
    };
}

function readTool(executed: string[]): AgentToolRuntime {
    return {
        name: 'get_store_overview',
        kind: 'read',
        risk: 'low',
        capability: { resource: 'reports', action: 'read' },
        execute: async () => {
            executed.push('get_store_overview');
            return { summary: '7 sales, revenue 100', data: { revenue: 100, sales: 7 } };
        },
    };
}

function writeTool(executed: string[]): AgentToolRuntime {
    return {
        name: 'create_customer',
        kind: 'write',
        risk: 'medium',
        capability: { resource: 'customers', action: 'create' },
        execute: async () => {
            executed.push('create_customer');
            return { summary: 'Created customer Asha', data: { created: true } };
        },
    };
}

const overviewSpec: AiProviderToolSpec = {
    type: 'function',
    function: {
        name: 'get_store_overview',
        description: 'Store overview',
        parameters: { type: 'object', properties: { days: { type: 'number' } } },
    },
};
const customerSpec: AiProviderToolSpec = {
    type: 'function',
    function: {
        name: 'create_customer',
        description: 'Create customer',
        parameters: {
            type: 'object',
            properties: { name: { type: 'string' }, phone: { type: 'string' } },
            required: ['name', 'phone'],
        },
    },
};

function turnOptions(
    provider: AiProviderConfig,
    harness: Harness,
    tools: AgentToolRuntime[],
    providerTools: AiProviderToolSpec[],
    overrides: Partial<RunAgentTurnOptions> = {}
): RunAgentTurnOptions {
    return {
        provider,
        profile: getHarnessProfile('analyst'),
        systemPrompt: 'You are a test assistant.',
        tools,
        providerTools,
        history: harness.events,
        appendEvent: harness.appendEvent,
        emit: (event) => harness.emitted.push(event),
        capabilityCheck: async () => true,
        actorEmail: 'operator@shop.test',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Scenario A — read tool round trip over fragmented SSE
// ---------------------------------------------------------------------------

test('read tool: streams fragmented SSE, executes the tool, pairs results and finishes', async () => {
    const provider = await startFakeProvider(async (callIndex, body, res) => {
        if (callIndex === 0) {
            sseHead(res);
            await writeFragmented(res, contentFrame('Checking the'));
            // Split the tool call arguments across three frames.
            await writeFragmented(res, toolCallFrame('call_read_1', 'get_store_overview', '{"da', 0, true));
            await writeFragmented(res, toolCallFrame('call_read_1', 'get_store_overview', 'ys":7}', 0, false));
            await writeFragmented(res, frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
            await writeFragmented(res, 'data: [DONE]\n\n');
            res.end();
            assert.equal(Array.isArray(body.tools), true);
            return;
        }
        await writeSse(res, [contentFrame('Revenue was ₹100 over 7 sales.'), 'data: [DONE]\n\n']);
    });
    try {
        const executed: string[] = [];
        const harness = createHarness();
        const result = await runAgentTurn(
            turnOptions(makeProvider(provider.baseUrl), harness, [readTool(executed)], [overviewSpec], {
                input: 'How were sales last week?',
                systemPrompt: 'Store analyst system prompt',
            })
        );

        assert.equal(result.status, 'completed');
        assert.deepEqual(executed, ['get_store_overview']);
        assert.equal(provider.calls.length, 2);

        const roles = deriveModelHistory(harness.events).map((message) => message.role);
        assert.deepEqual(roles, ['user', 'assistant', 'tool', 'assistant']);
        const history = deriveModelHistory(harness.events);
        assert.equal(history[2].tool_call_id, 'call_read_1');
        assert.match(history[2].content ?? '', /^<tool_result name="get_store_overview" trusted="false">/);
        assert.match(history[2].content ?? '', /"summary":"7 sales, revenue 100"/);

        // The streamed text reached the UI events, including the ₹ character.
        const textDeltas = harness.emitted
            .filter((event): event is Extract<AiStreamEvent, { event: 'text' }> => event.event === 'text')
            .map((event) => event.data.delta)
            .join('');
        assert.match(textDeltas, /Checking the/);
        assert.match(textDeltas, /₹100/);

        // The first request carried the exact system prompt and tool menu.
        const firstMessages = provider.calls[0].messages as Array<Record<string, unknown>>;
        assert.equal(firstMessages[0].role, 'system');
        assert.equal(firstMessages[0].content, 'Store analyst system prompt');

        const transcript = projectConversation(harness.events);
        assert.deepEqual(transcript.map((message) => message.role), ['user', 'assistant', 'tool', 'assistant']);
        assert.equal(transcript[2].toolResult?.status, 'ok');
    } finally {
        await provider.close();
    }
});

// ---------------------------------------------------------------------------
// Scenario A2 — a strict OpenAI-compatible provider validates the wire shape
// ---------------------------------------------------------------------------

test('strict provider: the second request carries valid OpenAI tool_calls and tool replies', async () => {
    const provider = await startFakeProvider(async (callIndex, body, res) => {
        const messages = (body.messages ?? []) as Array<Record<string, unknown>>;
        for (const message of messages) {
            if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
            for (const call of message.tool_calls as Array<Record<string, unknown>>) {
                if (call.type !== 'function' || typeof call.function !== 'object') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: 'messages[].tool_calls must use the function wire shape' } }));
                    return;
                }
            }
        }
        if (callIndex === 0) {
            await writeSse(res, [
                toolCallFrame('call_strict_1', 'get_store_overview', '{"days":7}'),
                'data: [DONE]\n\n',
            ]);
            return;
        }
        const toolMessage = messages.find((message) => message.role === 'tool');
        if (!toolMessage || toolMessage.tool_call_id !== 'call_strict_1') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'missing tool reply for call_strict_1' } }));
            return;
        }
        await writeSse(res, [contentFrame('Strict provider accepted the history.'), 'data: [DONE]\n\n']);
    });
    try {
        const executed: string[] = [];
        const harness = createHarness();
        const result = await runAgentTurn(
            turnOptions(makeProvider(provider.baseUrl), harness, [readTool(executed)], [overviewSpec], {
                input: 'How were sales?',
            })
        );
        assert.equal(result.status, 'completed');
        assert.deepEqual(executed, ['get_store_overview']);
        assert.equal(provider.calls.length, 2);
    } finally {
        await provider.close();
    }
});

// ---------------------------------------------------------------------------
// Scenario B — write approval, resume once, replay is rejected
// ---------------------------------------------------------------------------

test('write tool: pauses for approval, executes only after approval, replay does nothing', async () => {
    const provider = await startFakeProvider(async (callIndex, _body, res) => {
        if (callIndex === 0) {
            await writeSse(res, [
                toolCallFrame('call_write_1', 'create_customer', '{"name":"Asha","phone":"9876543210"}'),
                frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
                'data: [DONE]\n\n',
            ]);
            return;
        }
        await writeSse(res, [contentFrame('Customer Asha was created.'), 'data: [DONE]\n\n']);
    });
    try {
        const executed: string[] = [];
        const harness = createHarness();
        const profile = getHarnessProfile('operator');
        const options = turnOptions(makeProvider(provider.baseUrl), harness, [writeTool(executed)], [customerSpec], {
            profile,
            input: 'Create a customer named Asha with phone 9876543210.',
        });

        const paused = await runAgentTurn(options);
        assert.equal(paused.status, 'awaiting_approval');
        assert.deepEqual(executed, []);
        const pending = getPendingToolCalls(harness.events);
        assert.equal(pending.length, 1);
        assert.equal(pending[0].callId, 'call_write_1');
        assert.equal(provider.calls.length, 1);
        assert.equal(harness.events.some((record) => record.event.type === 'approval/request'), true);

        const resumed = await runAgentTurn({
            ...options,
            history: harness.events,
            input: undefined,
            approvals: [pending[0].callId],
        });
        assert.equal(resumed.status, 'completed');
        assert.deepEqual(executed, ['create_customer']);
        assert.equal(getPendingToolCalls(harness.events).length, 0);
        assert.equal(provider.calls.length, 2);
        const toolResult = harness.events.find(
            (record) => record.event.type === 'tool/result' && record.event.callId === 'call_write_1'
        );
        assert.equal(toolResult?.event.type, 'tool/result');
        if (toolResult?.event.type === 'tool/result') assert.equal(toolResult.event.status, 'ok');
        const decision = harness.events.find(
            (record) => record.event.type === 'approval/decision' && record.event.callId === 'call_write_1'
        );
        assert.equal(decision?.event.type, 'approval/decision');
        if (decision?.event.type === 'approval/decision') {
            assert.equal(decision.event.approved, true);
        }

        // Replaying the same approvals must not execute the write again.
        const replay = await runAgentTurn({
            ...options,
            history: harness.events,
            input: undefined,
            approvals: [pending[0].callId],
        });
        assert.equal(replay.status, 'error');
        assert.deepEqual(executed, ['create_customer']);
        assert.equal(provider.calls.length, 2);
    } finally {
        await provider.close();
    }
});

// ---------------------------------------------------------------------------
// Scenario C — operator denies the write; the turn continues safely
// ---------------------------------------------------------------------------

test('write tool: denial records a denied result, never executes, and the model continues', async () => {
    const provider = await startFakeProvider(async (callIndex, _body, res) => {
        if (callIndex === 0) {
            await writeSse(res, [
                toolCallFrame('call_write_2', 'create_customer', '{"name":"Ravi","phone":"9998887776"}'),
                'data: [DONE]\n\n',
            ]);
            return;
        }
        await writeSse(res, [contentFrame('Understood — I did not create the customer.'), 'data: [DONE]\n\n']);
    });
    try {
        const executed: string[] = [];
        const harness = createHarness();
        const options = turnOptions(
            makeProvider(provider.baseUrl),
            harness,
            [writeTool(executed)],
            [customerSpec],
            { profile: getHarnessProfile('operator'), input: 'Create Ravi.' }
        );
        const paused = await runAgentTurn(options);
        assert.equal(paused.status, 'awaiting_approval');

        const resumed = await runAgentTurn({
            ...options,
            history: harness.events,
            input: undefined,
            approvals: [],
        });
        assert.equal(resumed.status, 'completed');
        assert.deepEqual(executed, []);
        const denied = harness.events.find(
            (record) => record.event.type === 'tool/result' && record.event.callId === 'call_write_2'
        );
        assert.equal(denied?.event.type, 'tool/result');
        if (denied?.event.type === 'tool/result') {
            assert.equal(denied.event.status, 'denied');
            assert.match(denied.event.error ?? '', /did not approve/i);
        }
    } finally {
        await provider.close();
    }
});

// ---------------------------------------------------------------------------
// Scenario D — provider rejects tools: retry without tools, plain answer works
// ---------------------------------------------------------------------------

test('provider without tool support: retries without tools and still answers', async () => {
    const provider = await startFakeProvider(async (callIndex, body, res) => {
        if (callIndex === 0) {
            assert.equal(Array.isArray(body.tools), true);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'tools are not supported by this endpoint' } }));
            return;
        }
        assert.equal(body.tools, undefined);
        await writeSse(res, [contentFrame('Plain answer without tools.'), 'data: [DONE]\n\n']);
    });
    try {
        const executed: string[] = [];
        const harness = createHarness();
        const result = await runAgentTurn(
            turnOptions(makeProvider(provider.baseUrl), harness, [readTool(executed)], [overviewSpec], {
                input: 'What is revenue?',
            })
        );
        assert.equal(result.status, 'completed');
        assert.deepEqual(executed, []);
        assert.equal(provider.calls.length, 2);
        assert.equal(harness.events.some((record) => record.event.type === 'tool/result'), false);
    } finally {
        await provider.close();
    }
});

// ---------------------------------------------------------------------------
// Scenario E — client cancellation keeps the log consistent
// ---------------------------------------------------------------------------

test('cancellation aborts the stream, persists partial text and keeps history valid', async () => {
    const provider = await startFakeProvider(async (_callIndex, _body, res) => {
        sseHead(res);
        res.write(contentFrame('Hello '));
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (!res.destroyed) {
            res.write(contentFrame('world'));
            res.end('data: [DONE]\n\n');
        }
    });
    try {
        const harness = createHarness();
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 120);
        const result = await runAgentTurn(
            turnOptions(makeProvider(provider.baseUrl), harness, [readTool([])], [overviewSpec], {
                input: 'Say hello slowly.',
                signal: controller.signal,
            })
        );
        assert.equal(result.status, 'cancelled');
        const history = deriveModelHistory(harness.events);
        assert.deepEqual(history.map((message) => message.role), ['user', 'assistant']);
        assert.match(history[1].content ?? '', /Hello/);
        assert.equal(getPendingToolCalls(harness.events).length, 0);
    } finally {
        await provider.close();
    }
});

// ---------------------------------------------------------------------------
// Scenario F/G — loop budgets
// ---------------------------------------------------------------------------

test('maxSteps is enforced when the model keeps calling tools', async () => {
    const provider = await startFakeProvider(async (_callIndex, _body, res) => {
        await writeSse(res, [
            toolCallFrame('call_loop_1', 'get_store_overview', '{}'),
            'data: [DONE]\n\n',
        ]);
    });
    try {
        const executed: string[] = [];
        const harness = createHarness();
        const result = await runAgentTurn(
            turnOptions(makeProvider(provider.baseUrl), harness, [readTool(executed)], [overviewSpec], {
                input: 'Loop please.',
                profile: { ...getHarnessProfile('analyst'), maxSteps: 2 },
            })
        );
        assert.equal(result.status, 'max_steps');
        assert.deepEqual(executed, ['get_store_overview', 'get_store_overview']);
    } finally {
        await provider.close();
    }
});

test('excess tool calls in one step are denied without executing', async () => {
    const provider = await startFakeProvider(async (callIndex, _body, res) => {
        if (callIndex === 0) {
            await writeSse(res, [
                toolCallFrame('call_many_1', 'get_store_overview', '{}', 0, true),
                toolCallFrame('call_many_2', 'get_store_overview', '{}', 1, true),
                'data: [DONE]\n\n',
            ]);
            return;
        }
        await writeSse(res, [contentFrame('Enough data.'), 'data: [DONE]\n\n']);
    });
    try {
        const executed: string[] = [];
        const harness = createHarness();
        const result = await runAgentTurn(
            turnOptions(makeProvider(provider.baseUrl), harness, [readTool(executed)], [overviewSpec], {
                input: 'Call twice.',
                profile: { ...getHarnessProfile('analyst'), maxToolCallsPerStep: 1 },
            })
        );
        assert.equal(result.status, 'completed');
        assert.deepEqual(executed, ['get_store_overview']);
        const denied = harness.events.filter(
            (record) => record.event.type === 'tool/result' && record.event.status === 'denied'
        );
        assert.equal(denied.length, 1);
    } finally {
        await provider.close();
    }
});
