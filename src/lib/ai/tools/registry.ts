/**
 * ERP tool registry: the "tool guidance / tool interface" component of the
 * harness.
 *
 * A tool is a name, a JSON schema (zod, converted for the provider) and a
 * handler that runs against the authenticated operator's PocketBase client.
 * Handlers never accept a tenant or account from the model — the context is
 * bound server-side from the verified session.
 */

import { z } from 'zod';
import type PocketBase from 'pocketbase';
import type {
    AiHarnessProfile,
    AiProviderToolSpec,
    AiToolCapability,
    AiToolExecution,
    AiToolKind,
    AiToolRisk,
    AgentToolRuntime,
} from '../types';
import { profileAllowsTool } from '../harness';
import { MAX_TOOL_ARGUMENT_CHARS } from '../guardrails';
import { readTools } from './erp-read';
import { writeTools } from './erp-write';

export interface AiToolContext {
    client: PocketBase;
    accountEmail: string;
    conversationId: string;
    sessionEmail: string;
    userId?: string;
    now: Date;
}

export interface AiTool {
    name: string;
    title: string;
    description: string;
    kind: AiToolKind;
    risk: AiToolRisk;
    capability?: AiToolCapability;
    input: z.ZodType;
    execute: (context: AiToolContext, args: unknown) => Promise<AiToolExecution>;
}

/** Raised when model-supplied arguments fail schema validation. */
export class AiToolInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AiToolInputError';
    }
}

const ALL_TOOLS: AiTool[] = [...readTools, ...writeTools];

export function listAllToolNames(): string[] {
    return ALL_TOOLS.map((tool) => tool.name);
}

export function findTool(name: string): AiTool | undefined {
    return ALL_TOOLS.find((tool) => tool.name === name);
}

/** Tools visible in a profile, before role-capability filtering. */
export function toolsForProfile(profile: AiHarnessProfile): AiTool[] {
    return ALL_TOOLS.filter((tool) => profileAllowsTool(profile, tool.name))
        .filter((tool) => tool.kind === 'read' || profile.allowWrites);
}

/**
 * Convert zod to the provider's JSON-schema dialect. `$schema` is an OpenAPI
 * keyword most non-OpenAI gateways ignore or reject, so it is stripped.
 */
export function toProviderToolSpec(tool: AiTool): AiProviderToolSpec {
    const schema = z.toJSONSchema(tool.input) as Record<string, unknown>;
    const { $schema: _unusedSchema, ...parameters } = schema;
    void _unusedSchema;
    return {
        type: 'function',
        function: {
            name: tool.name,
            description: `${tool.title}. ${tool.description}`,
            parameters,
        },
    };
}

export function toProviderToolSpecs(tools: AiTool[]): AiProviderToolSpec[] {
    return tools.map(toProviderToolSpec);
}

/** Stable display metadata for the status endpoint and the UI. */
export function describeTools(tools: AiTool[] = ALL_TOOLS): Array<{
    name: string;
    title: string;
    description: string;
    kind: AiToolKind;
    risk: AiToolRisk;
    capability?: AiToolCapability;
}> {
    return tools.map(({ name, title, description, kind, risk, capability }) => ({
        name,
        title,
        description,
        kind,
        risk,
        capability,
    }));
}

/**
 * Bind one tool to the server-side context and expose it to the agent loop.
 * Argument size is bounded here because the raw string is model output; zod
 * then validates the decoded object.
 */
export function createToolRuntime(tool: AiTool, context: AiToolContext): AgentToolRuntime {
    return {
        name: tool.name,
        kind: tool.kind,
        risk: tool.risk,
        capability: tool.capability,
        execute: async (args: unknown) => {
            let rawLength = 0;
            try {
                rawLength = JSON.stringify(args).length;
            } catch {
                rawLength = 0;
            }
            if (rawLength > MAX_TOOL_ARGUMENT_CHARS) {
                throw new AiToolInputError('Tool arguments are too large.');
            }
            const parsed = tool.input.safeParse(args ?? {});
            if (!parsed.success) {
                const issue = parsed.error.issues[0];
                const path = issue?.path?.join('.') || 'arguments';
                throw new AiToolInputError(`Invalid ${path}: ${issue?.message ?? 'argument does not match the schema.'}`);
            }
            return tool.execute(context, parsed.data);
        },
    };
}

/** Bind every visible tool for this profile into runtimes the loop can call. */
export function createToolRuntimes(tools: AiTool[], context: AiToolContext): AgentToolRuntime[] {
    return tools.map((tool) => createToolRuntime(tool, context));
}
