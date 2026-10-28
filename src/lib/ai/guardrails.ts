/**
 * Guardrails: the pure policy layer between a model's tool call and the ERP.
 *
 * Three questions are answered here, all without I/O so they are exhaustively
 * testable:
 *  1. may this tool be shown/run for this profile and capability set?
 *  2. if it is a write, has the operator approved this exact call?
 *  3. are the model-supplied arguments within size/shape limits?
 *
 * The capability lookup is injected; the server wires it to PocketBase RBAC,
 * the tests wire it to a dictionary.
 */

import type { AiHarnessProfile, AiToolKind, AiToolRisk } from './types';
import { profileAllowsTool } from './harness';

export const MAX_TOOL_ARGUMENT_CHARS = 20_000;
export const MAX_TOOL_RESULT_CHARS = 12_000;
export const MAX_SUMMARY_CHARS = 2_000;

export interface ToolPolicyInput {
    toolName: string;
    kind: AiToolKind;
    risk: AiToolRisk;
    profile: AiHarnessProfile;
    capabilityGranted: boolean;
    /** True when the operator explicitly approved this exact pending call id. */
    approved: boolean;
}

export interface ToolPolicyDecision {
    allowed: boolean;
    requiresApproval: boolean;
    reason?: string;
}

/**
 * Decide whether one tool call may run now.
 *
 * Order matters: profile allow-list → role capability → write approval. A write
 * that fails the capability check is denied outright (never offered to the
 * approval UI) so approval cannot be used to escalate privileges.
 */
export function decideToolPolicy(input: ToolPolicyInput): ToolPolicyDecision {
    if (!profileAllowsTool(input.profile, input.toolName)) {
        return { allowed: false, requiresApproval: false, reason: 'This tool is not enabled in the selected harness profile.' };
    }
    if (!input.capabilityGranted) {
        return {
            allowed: false,
            requiresApproval: false,
            reason: 'Your role does not grant the capability this tool needs.',
        };
    }
    if (input.kind === 'write') {
        if (!input.profile.allowWrites) {
            return {
                allowed: false,
                requiresApproval: false,
                reason: 'This harness profile is read-only; switch to the Operations profile to request writes.',
            };
        }
        return input.approved
            ? { allowed: true, requiresApproval: false }
            : { allowed: true, requiresApproval: true, reason: 'Write tools require explicit operator approval.' };
    }
    return { allowed: true, requiresApproval: false };
}

/** Risk label shown on the approval card. */
export function approvalRiskFor(kind: AiToolKind, baseRisk: AiToolRisk): AiToolRisk {
    if (kind === 'read') return 'low';
    return baseRisk;
}

export interface ParsedToolArguments {
    ok: boolean;
    value?: unknown;
    error?: string;
}

/**
 * Parse and bound the JSON string a model produced for a tool call. The model
 * output is a wire boundary, so this validates JSON shape and absolute size
 * before zod sees it.
 */
export function parseToolArguments(raw: string | undefined): ParsedToolArguments {
    const text = (raw ?? '').trim();
    if (!text) return { ok: true, value: {} };
    if (text.length > MAX_TOOL_ARGUMENT_CHARS) {
        return { ok: false, error: `Tool arguments exceeded ${MAX_TOOL_ARGUMENT_CHARS} characters.` };
    }
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        return { ok: false, error: 'Tool arguments were not valid JSON.' };
    }
}

/** Redact any known secret from text that may reach logs, errors or the UI. */
export function redactSecrets(text: string, secrets: Array<string | undefined | null>): string {
    let result = text;
    for (const secret of secrets) {
        if (!secret || secret.length < 4) continue;
        result = result.split(secret).join('[redacted]');
    }
    return result;
}

/** A compact, log-safe rendering of tool arguments for the audit trail. */
export function summarizeArgumentsForAudit(args: unknown, max = MAX_SUMMARY_CHARS): string {
    let text: string;
    try {
        text = typeof args === 'string' ? args : JSON.stringify(args);
    } catch {
        text = '[unserializable arguments]';
    }
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Truncate a tool result before it is echoed to the model or the UI. */
export function capText(text: string, max = MAX_TOOL_RESULT_CHARS): string {
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 20))}\n…[truncated]`;
}

/** True when the operator has approved this specific call id. */
export function isCallApproved(approvedIds: Iterable<string>, callId: string): boolean {
    for (const id of approvedIds) {
        if (id === callId) return true;
    }
    return false;
}
