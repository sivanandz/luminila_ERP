/**
 * Server-sent-event and OpenAI-stream parsing for the harness.
 *
 * Everything here is pure: no `fetch`, no timers, no Node built-ins. The HTTP
 * transport lives in `openai-compatible.ts`; the browser client reuses the SSE
 * parser through `src/lib/ai-client.ts`. Keeping parsing pure is what lets the
 * test suite feed arbitrarily fragmented chunks and assert exact behaviour.
 */

export const MAX_SSE_FRAME_CHARS = 1_048_576;

export interface SseFrame {
    event?: string;
    data: string;
    id?: string;
}

interface PendingSseFrame {
    event?: string;
    dataLines: string[];
    id?: string;
}

/**
 * Incremental SSE parser for `text/event-stream` bodies.
 *
 * Handles `\n`, `\r\n` and `\r` terminators, multi-line `data:` fields,
 * comments (`: keep-alive`) and chunk boundaries that split a terminator or a
 * `data:` line. Call `flush()` after the last chunk to emit a trailing frame
 * that lacks a final blank line.
 */
export class SseParser {
    private buffer = '';
    private pending: PendingSseFrame = { dataLines: [] };

    push(chunk: string): SseFrame[] {
        if (!chunk) return [];
        // Tolerate a UTF-8 BOM at the very start of the stream.
        if (this.buffer.length === 0 && chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
        this.buffer += chunk;
        if (this.buffer.length > MAX_SSE_FRAME_CHARS) {
            this.buffer = '';
            this.pending = { dataLines: [] };
            throw new Error('The provider stream contained an oversized SSE frame.');
        }
        const frames: SseFrame[] = [];
        for (;;) {
            const terminator = this.findLineTerminator();
            if (!terminator) break;
            const line = this.buffer.slice(0, terminator.index);
            this.buffer = this.buffer.slice(terminator.index + terminator.length);
            this.consumeLine(line, frames);
        }
        return frames;
    }

    flush(): SseFrame[] {
        const frames: SseFrame[] = [];
        if (this.buffer.length > 0) {
            const line = this.buffer;
            this.buffer = '';
            this.consumeLine(line, frames);
        }
        this.dispatch(frames);
        return frames;
    }

    reset(): void {
        this.buffer = '';
        this.pending = { dataLines: [] };
    }

    private findLineTerminator(): { index: number; length: number } | null {
        for (let i = 0; i < this.buffer.length; i += 1) {
            const char = this.buffer[i];
            if (char === '\r') {
                // A trailing `\r` may be the first half of a `\r\n` split across
                // chunks; wait for the next chunk instead of misparsing it.
                if (i === this.buffer.length - 1) return null;
                return { index: i, length: this.buffer[i + 1] === '\n' ? 2 : 1 };
            }
            if (char === '\n') return { index: i, length: 1 };
        }
        return null;
    }

    private consumeLine(line: string, frames: SseFrame[]): void {
        if (line === '') {
            this.dispatch(frames);
            return;
        }
        if (line.startsWith(':')) return;

        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);

        if (field === 'data') this.pending.dataLines.push(value);
        else if (field === 'event') this.pending.event = value;
        else if (field === 'id') this.pending.id = value;
        // `retry` and unknown fields are irrelevant to this client.
    }

    private dispatch(frames: SseFrame[]): void {
        const { dataLines, event, id } = this.pending;
        if (dataLines.length === 0 && event === undefined) {
            this.pending = { dataLines: [] };
            return;
        }
        frames.push({ event, id, data: dataLines.join('\n') });
        this.pending = { dataLines: [] };
    }
}

/** Convenience for tests and non-streaming callers. */
export function parseSseText(text: string): SseFrame[] {
    const parser = new SseParser();
    return [...parser.push(text), ...parser.flush()];
}

/** Encode one SSE frame for a `Response` body. */
export function encodeSseEvent(event: string, data: unknown): string {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const safePayload = payload.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = safePayload.split('\n').map((line) => `data: ${line}`).join('\n');
    return `event: ${event}\n${lines}\n\n`;
}

export interface OpenAiUsageRaw {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
}

export interface OpenAiToolCallDelta {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
}

/** Incremental update produced by one streamed chunk. */
export interface OpenAiStreamUpdate {
    content?: string;
    reasoning?: string;
    toolCall?: OpenAiToolCallDelta;
    usage?: OpenAiUsageRaw;
    finishReason?: string;
    done?: boolean;
    error?: string;
}

interface ToolCallAccumulator {
    id: string;
    name: string;
    arguments: string;
}

/**
 * Accumulates OpenAI-compatible streaming chunks into text, reasoning and
 * complete tool calls. Most providers stream tool arguments as JSON fragments
 * keyed by `index`; a few send the whole call at once. Both shapes work.
 */
export class OpenAiStreamTracker {
    private textValue = '';
    private reasoningValue = '';
    private readonly toolCalls = new Map<number, ToolCallAccumulator>();
    private usageValue: OpenAiUsageRaw | undefined;
    private finishReasonValue: string | undefined;
    private doneValue = false;
    private errorValue: string | undefined;

    get text(): string {
        return this.textValue;
    }

    get reasoning(): string {
        return this.reasoningValue;
    }

    get usage(): OpenAiUsageRaw | undefined {
        return this.usageValue;
    }

    get finishReason(): string | undefined {
        return this.finishReasonValue;
    }

    get done(): boolean {
        return this.doneValue;
    }

    get error(): string | undefined {
        return this.errorValue;
    }

    /** Feed one parsed SSE frame; returns the deltas it carried. */
    consumeFrame(frame: SseFrame): OpenAiStreamUpdate[] {
        if (frame.event === 'done') {
            this.doneValue = true;
            return [{ done: true }];
        }
        return this.consumeData(frame.data);
    }

    /** Feed one raw `data:` payload. */
    consumeData(data: string): OpenAiStreamUpdate[] {
        const trimmed = data.trim();
        if (!trimmed) return [];
        if (trimmed === '[DONE]') {
            this.doneValue = true;
            return [{ done: true }];
        }

        let payload: unknown;
        try {
            payload = JSON.parse(trimmed);
        } catch {
            // A provider that streams non-JSON protocol noise is broken; surface
            // it instead of silently returning an empty answer.
            this.errorValue = 'The provider stream contained a malformed JSON frame.';
            return [{ error: this.errorValue }];
        }
        return this.consumePayload(payload);
    }

    /** Feed one decoded JSON payload (exported for the non-streaming path). */
    consumePayload(payload: unknown): OpenAiStreamUpdate[] {
        const updates: OpenAiStreamUpdate[] = [];
        if (!payload || typeof payload !== 'object') return updates;
        const record = payload as Record<string, unknown>;

        if (record.error !== undefined) {
            this.errorValue = extractOpenAiErrorMessage(record.error);
            updates.push({ error: this.errorValue });
            return updates;
        }

        const usage = parseOpenAiUsage(record.usage);
        if (usage) {
            this.usageValue = usage;
            updates.push({ usage });
        }

        const choices = record.choices;
        if (!Array.isArray(choices) || choices.length === 0) {
            // Some providers emit a final usage-only chunk with no choices.
            return updates;
        }
        const choice = choices[0] as Record<string, unknown> | null;
        if (!choice || typeof choice !== 'object') return updates;

        const delta = (choice.delta ?? choice.message) as Record<string, unknown> | undefined;
        if (delta && typeof delta === 'object') {
            const content = coerceText(delta.content);
            if (content) {
                this.textValue += content;
                updates.push({ content });
            }
            const reasoning = coerceText(delta.reasoning_content) || coerceText(delta.reasoning);
            if (reasoning) {
                this.reasoningValue += reasoning;
                updates.push({ reasoning });
            }
            const toolDeltas = parseToolCallDeltas(delta.tool_calls);
            for (const toolDelta of toolDeltas) {
                this.applyToolCallDelta(toolDelta);
                updates.push({ toolCall: toolDelta });
            }
            // Legacy single-function-call shape (pre-tool_calls providers).
            const legacy = delta.function_call;
            if (toolDeltas.length === 0 && legacy && typeof legacy === 'object') {
                const legacyRecord = legacy as Record<string, unknown>;
                const legacyName = coerceText(legacyRecord.name);
                if (legacyName) {
                    const legacyDelta: OpenAiToolCallDelta = {
                        index: 0,
                        id: 'call_legacy_0',
                        name: legacyName,
                        argumentsDelta: coerceText(legacyRecord.arguments),
                    };
                    this.applyToolCallDelta(legacyDelta);
                    updates.push({ toolCall: legacyDelta });
                }
            }
        }

        const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined;
        if (finishReason) {
            this.finishReasonValue = finishReason;
            updates.push({ finishReason });
        }
        return updates;
    }

    /** Assembled tool calls in the order the provider streamed them. */
    assembledToolCalls(): Array<{ id: string; name: string; arguments: string }> {
        return [...this.toolCalls.entries()]
            .sort(([a], [b]) => a - b)
            .map(([index, call], position) => ({
                id: call.id || `call_${index}_${position}`,
                name: call.name,
                arguments: call.arguments,
            }))
            .filter((call) => call.name.length > 0);
    }

    private applyToolCallDelta(delta: OpenAiToolCallDelta): void {
        const existing = this.toolCalls.get(delta.index) ?? { id: '', name: '', arguments: '' };
        if (delta.id) existing.id = delta.id;
        if (delta.name) existing.name = delta.name;
        if (delta.argumentsDelta) existing.arguments += delta.argumentsDelta;
        this.toolCalls.set(delta.index, existing);
    }
}

export interface OpenAiCompletionResult {
    text: string;
    reasoning: string;
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
    usage?: OpenAiUsageRaw;
    finishReason?: string;
}

/**
 * Parse a non-streaming `/chat/completions` body. Some OpenAI-compatible
 * gateways ignore `stream: true` and answer with plain JSON, so the transport
 * must accept both shapes.
 */
export function parseOpenAiCompletion(payload: unknown): OpenAiCompletionResult {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Provider returned a non-JSON response body.');
    }
    const record = payload as Record<string, unknown>;
    if (record.error !== undefined) {
        throw new Error(extractOpenAiErrorMessage(record.error));
    }
    const choices = record.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
        throw new Error('Provider response contained no choices.');
    }
    const choice = choices[0] as Record<string, unknown>;
    const message = (choice.message ?? {}) as Record<string, unknown>;
    const text = coerceText(message.content);
    const reasoning = coerceText(message.reasoning_content) || coerceText(message.reasoning);
    const toolCalls = parseToolCallDeltas(message.tool_calls).map((delta) => ({
        id: delta.id || `call_${delta.index}`,
        name: delta.name || '',
        arguments: delta.argumentsDelta || '',
    })).filter((call) => call.name.length > 0);
    if (toolCalls.length === 0 && message.function_call && typeof message.function_call === 'object') {
        const legacy = message.function_call as Record<string, unknown>;
        const name = coerceText(legacy.name);
        if (name) toolCalls.push({ id: 'call_legacy_0', name, arguments: coerceText(legacy.arguments) });
    }
    return {
        text,
        reasoning,
        toolCalls,
        usage: parseOpenAiUsage(record.usage),
        finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined,
    };
}

/** Best-effort displayable message from an OpenAI-style error payload. */
export function extractOpenAiErrorMessage(error: unknown): string {
    if (typeof error === 'string') return error.slice(0, 500);
    if (!error || typeof error !== 'object') return 'The provider returned an unknown error.';
    const record = error as Record<string, unknown>;
    const message = record.message;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 500);
    const detail = record.detail;
    if (typeof detail === 'string' && detail.trim()) return detail.trim().slice(0, 500);
    try {
        return JSON.stringify(error).slice(0, 500);
    } catch {
        return 'The provider returned an unknown error.';
    }
}

function coerceText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        // A few providers return content as [{type:'text', text:'...'}].
        return value
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object') {
                    const text = (part as Record<string, unknown>).text;
                    if (typeof text === 'string') return text;
                }
                return '';
            })
            .join('');
    }
    return '';
}

function parseOpenAiUsage(value: unknown): OpenAiUsageRaw | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const usage: OpenAiUsageRaw = {};
    if (typeof record.prompt_tokens === 'number') usage.prompt_tokens = record.prompt_tokens;
    if (typeof record.completion_tokens === 'number') usage.completion_tokens = record.completion_tokens;
    if (typeof record.total_tokens === 'number') usage.total_tokens = record.total_tokens;
    return Object.keys(usage).length > 0 ? usage : undefined;
}

function parseToolCallDeltas(value: unknown): OpenAiToolCallDelta[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry, position): OpenAiToolCallDelta | null => {
            if (!entry || typeof entry !== 'object') return null;
            const record = entry as Record<string, unknown>;
            const fn = (record.function ?? {}) as Record<string, unknown>;
            const index = typeof record.index === 'number' ? record.index : position;
            const delta: OpenAiToolCallDelta = { index };
            if (typeof record.id === 'string' && record.id) delta.id = record.id;
            if (typeof fn.name === 'string' && fn.name) delta.name = fn.name;
            const args = fn.arguments;
            if (typeof args === 'string' && args) delta.argumentsDelta = args;
            else if (args && typeof args === 'object') delta.argumentsDelta = JSON.stringify(args);
            return delta;
        })
        .filter((delta): delta is OpenAiToolCallDelta => delta !== null);
}
