/**
 * Harness profiles: named compositions of the components harness2 names
 * (tool guidance, guardrails, memory/context budget, prompt extras).
 *
 * A profile is deliberately data, not code: it selects which ERP tools the
 * model may see, whether writes are offered at all, and how many model/tool
 * steps one turn may consume. The agent loop enforces the budgets; the tool
 * registry enforces the allow-list.
 */

import type { AiHarnessProfile } from './types';

export const DEFAULT_PROFILE_ID = 'analyst';

const PROFILE_DEFINITIONS: AiHarnessProfile[] = [
    {
        id: 'analyst',
        name: 'Store Analyst',
        description:
            'Read-only analysis: sales, stock, customers, invoices, expenses. Safest profile; no writes are offered to the model.',
        allowedTools: '*',
        allowWrites: false,
        maxSteps: 6,
        maxToolCallsPerStep: 4,
        contextCharBudget: 48_000,
        extraSystemPrompt:
            'You are in read-only analysis mode. Prefer aggregate answers with the exact numbers you retrieved; ' +
            'never speculate about records you did not query.',
    },
    {
        id: 'operator',
        name: 'Operations Copilot',
        description:
            'Adds a small set of write tools (create a walk-in customer, append an internal order note). Every write pauses for explicit operator approval.',
        allowedTools: '*',
        allowWrites: true,
        maxSteps: 8,
        maxToolCallsPerStep: 4,
        contextCharBudget: 48_000,
        extraSystemPrompt:
            'Write actions always need the operator\'s explicit approval through the approval card. ' +
            'Before requesting a write, state exactly which record will change and why. Never chain multiple writes ' +
            'in one answer without the operator confirming each step.',
    },
];

export const MAX_PROMPT_TOOL_GUIDANCE_CHARS = 4_000;

/** All profiles exposed to the UI. Returns a copy so callers cannot mutate it. */
export function listHarnessProfiles(): AiHarnessProfile[] {
    return PROFILE_DEFINITIONS.map((profile) => ({ ...profile }));
}

/** Look up a profile; unknown ids fall back to the safest profile. */
export function getHarnessProfile(id: string | undefined): AiHarnessProfile {
    const found = PROFILE_DEFINITIONS.find((profile) => profile.id === id);
    return { ...(found ?? PROFILE_DEFINITIONS[0]) };
}

/** True when a profile includes a tool name. */
export function profileAllowsTool(profile: AiHarnessProfile, toolName: string): boolean {
    if (profile.allowedTools === '*') return true;
    return profile.allowedTools.includes(toolName);
}

/**
 * Trim a profile's tool list to the subset the operator's role may use. The
 * registry calls this before building provider tool schemas so a cashier never
 * sees an admin-only capability in the model's menu.
 */
export function profileAllowsWrites(profile: AiHarnessProfile): boolean {
    return profile.allowWrites;
}
