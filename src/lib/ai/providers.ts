/**
 * Provider configuration store (server-only).
 *
 * Security model:
 * - `ai_providers` rows are readable and writable only through the server
 *   (PocketBase API rules are null), so a browser can never enumerate keys.
 * - `api_key` is encrypted at rest with AES-256-GCM via `tenant-secrets.ts`.
 *   `AI_SECRET_KEY` takes precedence; `TENANT_REGISTRY_KEY` is accepted as the
 *   local-install fallback because it is already provisioned here.
 * - The browser-safe projection (`AiProviderPublic`) never contains key
 *   material or ciphertext.
 */

import type PocketBase from 'pocketbase';
import { z } from 'zod';
import type { AiMaxTokensParam, AiProviderConfig, AiProviderPublic } from './types';
import { decryptSecret, encryptSecret, parseRegistryKey } from '../tenant-secrets';

export const PROVIDERS_COLLECTION = 'ai_providers';

export class AiConfigError extends Error {
    readonly code: string;

    constructor(message: string, code = 'ai_config_error') {
        super(message);
        this.name = 'AiConfigError';
        this.code = code;
    }
}

const headerNameSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'Invalid header name.');
const headerValueSchema = z.string().max(1_000).refine((value) => !/[\r\n]/.test(value), 'Header values cannot contain line breaks.');

export const providerInputSchema = z.object({
    name: z.string().trim().min(1).max(80),
    baseUrl: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .refine((value) => {
            try {
                const url = new URL(value);
                return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
            } catch {
                return false;
            }
        }, 'Base URL must be an http(s) URL without embedded credentials.'),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().max(4_000).optional(),
    models: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
    customHeaders: z.record(headerNameSchema, headerValueSchema).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(200_000).optional(),
    maxTokensParam: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
    supportsTools: z.boolean().optional(),
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
});

export type ValidatedProviderInput = z.infer<typeof providerInputSchema>;

export interface ProviderRow {
    id: string;
    account_email?: string;
    name?: string;
    base_url?: string;
    api_key?: string;
    model?: string;
    models?: unknown;
    custom_headers?: unknown;
    temperature?: number;
    max_tokens?: number;
    max_tokens_param?: string;
    supports_tools?: boolean;
    enabled?: boolean;
    is_default?: boolean;
    timeout_ms?: number;
    last_test_ok?: boolean;
    last_tested_at?: string;
    created_by?: string;
    created?: string;
    updated?: string;
}

/** Resolve the encryption key for provider secrets. */
export function getProviderSecretKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
    const direct = parseRegistryKey(env.AI_SECRET_KEY);
    if (direct) return direct;
    return parseRegistryKey(env.TENANT_REGISTRY_KEY);
}

export function encryptProviderKey(plain: string, env: NodeJS.ProcessEnv = process.env): string {
    if (!plain) return '';
    const key = getProviderSecretKey(env);
    if (!key) {
        throw new AiConfigError(
            'Set AI_SECRET_KEY (64 hex characters) or TENANT_REGISTRY_KEY before saving a provider API key.',
            'missing_secret_key'
        );
    }
    return encryptSecret(plain, key);
}

function decryptProviderKey(value: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
    if (!value) return '';
    const key = getProviderSecretKey(env);
    try {
        return decryptSecret(value, key);
    } catch {
        throw new AiConfigError(
            'The stored provider API key cannot be decrypted with the configured secret key. Re-save the provider key.',
            'provider_key_undecryptable'
        );
    }
}

function parseJsonField<T>(value: unknown, fallback: T): T {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value) as T;
        } catch {
            return fallback;
        }
    }
    return value as T;
}

function normalizeMaxTokensParam(value: string | undefined): AiMaxTokensParam {
    return value === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens';
}

/** Decrypt a stored row into the in-memory provider config. */
export function rowToProvider(row: ProviderRow, env: NodeJS.ProcessEnv = process.env): AiProviderConfig {
    const baseUrl = String(row.base_url || '').trim();
    if (!baseUrl) throw new AiConfigError('Provider is missing a base URL.', 'provider_invalid');
    return {
        id: row.id,
        name: row.name || row.id,
        baseUrl,
        apiKey: decryptProviderKey(row.api_key, env),
        model: row.model || '',
        models: parseJsonField<string[]>(row.models, []),
        customHeaders: parseJsonField<Record<string, string>>(row.custom_headers, {}),
        temperature: typeof row.temperature === 'number' ? row.temperature : 0.3,
        maxTokens: typeof row.max_tokens === 'number' && row.max_tokens > 0 ? row.max_tokens : 2_048,
        maxTokensParam: normalizeMaxTokensParam(row.max_tokens_param),
        supportsTools: row.supports_tools !== false,
        enabled: row.enabled !== false,
        isDefault: row.is_default === true,
        timeoutMs: typeof row.timeout_ms === 'number' && row.timeout_ms > 0 ? row.timeout_ms : 120_000,
        source: 'database',
    };
}

/** Browser-safe projection: no plaintext key, no ciphertext. */
export function toPublicProvider(row: ProviderRow): AiProviderPublic {
    return {
        id: row.id,
        name: row.name || row.id,
        baseUrl: row.base_url || '',
        model: row.model || '',
        models: parseJsonField<string[]>(row.models, []),
        temperature: typeof row.temperature === 'number' ? row.temperature : 0.3,
        maxTokens: typeof row.max_tokens === 'number' ? row.max_tokens : 2_048,
        maxTokensParam: normalizeMaxTokensParam(row.max_tokens_param),
        supportsTools: row.supports_tools !== false,
        enabled: row.enabled !== false,
        isDefault: row.is_default === true,
        hasApiKey: Boolean(row.api_key),
        source: 'database',
        lastTestOk: typeof row.last_test_ok === 'boolean' ? row.last_test_ok : undefined,
        lastTestedAt: row.last_tested_at,
    };
}

/**
 * Environment-configured fallback provider, for deployments that prefer env
 * over the settings dialog. It is never editable from the UI.
 */
export function getEnvironmentProvider(env: NodeJS.ProcessEnv = process.env): AiProviderConfig | null {
    const baseUrl = (env.OPENAI_COMPAT_BASE_URL || '').trim();
    const model = (env.OPENAI_COMPAT_MODEL || '').trim();
    if (!baseUrl || !model) return null;
    return {
        id: 'environment',
        name: env.OPENAI_COMPAT_NAME || 'Environment provider',
        baseUrl,
        apiKey: (env.OPENAI_COMPAT_API_KEY || '').trim(),
        model,
        models: [],
        customHeaders: {},
        temperature: Number(env.OPENAI_COMPAT_TEMPERATURE || 0.3) || 0.3,
        maxTokens: Number(env.OPENAI_COMPAT_MAX_TOKENS || 2_048) || 2_048,
        maxTokensParam: normalizeMaxTokensParam(env.OPENAI_COMPAT_MAX_TOKENS_PARAM),
        supportsTools: (env.OPENAI_COMPAT_DISABLE_TOOLS || '').trim() !== '1',
        enabled: true,
        isDefault: true,
        timeoutMs: Number(env.OPENAI_COMPAT_TIMEOUT_MS || 120_000) || 120_000,
        source: 'environment',
    };
}

function accountClause(accountEmail: string): string {
    return `account_email="${accountEmail.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export async function listProviderRows(adminClient: PocketBase, accountEmail: string): Promise<ProviderRow[]> {
    const rows = await adminClient
        .collection(PROVIDERS_COLLECTION)
        .getFullList({ filter: accountClause(accountEmail), sort: '-is_default,-created' });
    return rows as unknown as ProviderRow[];
}

export async function listPublicProviders(
    adminClient: PocketBase,
    accountEmail: string,
    env: NodeJS.ProcessEnv = process.env
): Promise<AiProviderPublic[]> {
    const rows = await listProviderRows(adminClient, accountEmail);
    const providers = rows.map(toPublicProvider);
    const envProvider = getEnvironmentProvider(env);
    if (envProvider) {
        providers.push({
            id: envProvider.id,
            name: envProvider.name,
            baseUrl: envProvider.baseUrl,
            model: envProvider.model,
            models: [],
            temperature: envProvider.temperature,
            maxTokens: envProvider.maxTokens,
            maxTokensParam: envProvider.maxTokensParam,
            supportsTools: envProvider.supportsTools,
            enabled: true,
            isDefault: providers.length === 0,
            hasApiKey: Boolean(envProvider.apiKey),
            source: 'environment',
        });
    }
    return providers;
}

export interface ResolvedProvider {
    provider: AiProviderConfig;
    row?: ProviderRow;
}

/** Resolve the provider for one chat request, honoring an explicit selection. */
export async function resolveProviderForRequest(
    adminClient: PocketBase,
    accountEmail: string,
    providerId?: string,
    env: NodeJS.ProcessEnv = process.env
): Promise<ResolvedProvider> {
    const rows = await listProviderRows(adminClient, accountEmail);
    if (providerId === 'environment') {
        const envProvider = getEnvironmentProvider(env);
        if (!envProvider) throw new AiConfigError('The environment provider is not configured.', 'provider_not_found');
        return { provider: envProvider };
    }
    if (providerId) {
        const row = rows.find((candidate) => candidate.id === providerId);
        if (!row) throw new AiConfigError('The selected provider no longer exists.', 'provider_not_found');
        if (row.enabled === false) throw new AiConfigError('The selected provider is disabled.', 'provider_disabled');
        return { provider: rowToProvider(row, env), row };
    }
    const enabled = rows.filter((row) => row.enabled !== false && row.model && row.base_url);
    const preferred = enabled.find((row) => row.is_default === true) ?? enabled[0];
    if (preferred) return { provider: rowToProvider(preferred, env), row: preferred };
    const envProvider = getEnvironmentProvider(env);
    if (envProvider) return { provider: envProvider };
    throw new AiConfigError(
        'No AI provider is configured. An administrator can add one in the AI assistant settings.',
        'not_configured'
    );
}

/** Resolve a stored provider row by id (admin operations and connection tests). */
export async function getProviderRow(
    adminClient: PocketBase,
    accountEmail: string,
    providerId: string
): Promise<ProviderRow> {
    const rows = await listProviderRows(adminClient, accountEmail);
    const row = rows.find((candidate) => candidate.id === providerId);
    if (!row) throw new AiConfigError('Provider not found.', 'provider_not_found');
    return row;
}

export function validateProviderInput(input: unknown): ValidatedProviderInput {
    const parsed = providerInputSchema.safeParse(input);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path?.join('.') || 'provider';
        throw new AiConfigError(`${path}: ${issue?.message ?? 'invalid provider configuration'}`, 'invalid_provider');
    }
    return parsed.data;
}

/** Create or update one provider row; keeps exactly one default. */
export async function saveProvider(
    adminClient: PocketBase,
    accountEmail: string,
    input: ValidatedProviderInput,
    options: { providerId?: string; actorEmail?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<AiProviderPublic> {
    const env = options.env ?? process.env;
    const rows = await listProviderRows(adminClient, accountEmail);
    const existing = options.providerId ? rows.find((row) => row.id === options.providerId) : undefined;
    if (options.providerId && !existing) throw new AiConfigError('Provider not found.', 'provider_not_found');

    const payload: Record<string, unknown> = {
        account_email: accountEmail,
        name: input.name,
        base_url: input.baseUrl,
        model: input.model,
    };
    // On update only touch fields the caller actually sent: a name/model edit
    // must not silently re-enable a disabled provider, re-enable tools or wipe
    // custom headers.
    if (input.customHeaders !== undefined) payload.custom_headers = input.customHeaders;
    if (input.supportsTools !== undefined) payload.supports_tools = input.supportsTools;
    if (input.enabled !== undefined) payload.enabled = input.enabled;
    if (!existing) {
        payload.custom_headers = input.customHeaders ?? {};
        payload.supports_tools = input.supportsTools !== false;
        payload.enabled = input.enabled !== false;
    } else {
        // Explicitly carry the current values through so a partial edit cannot
        // reset them (and so the captured update payload is auditable).
        if (input.customHeaders === undefined) payload.custom_headers = parseJsonField<Record<string, string>>(existing.custom_headers, {});
        if (input.supportsTools === undefined) payload.supports_tools = existing.supports_tools !== false;
        if (input.enabled === undefined) payload.enabled = existing.enabled !== false;
    }
    if (input.models) payload.models = input.models;
    if (typeof input.temperature === 'number') payload.temperature = input.temperature;
    if (typeof input.maxTokens === 'number') payload.max_tokens = input.maxTokens;
    if (input.maxTokensParam) payload.max_tokens_param = input.maxTokensParam;
    if (typeof input.apiKey === 'string') {
        payload.api_key = input.apiKey.trim() ? encryptProviderKey(input.apiKey.trim(), env) : '';
    }
    const shouldBeDefault = input.isDefault === true || (!existing && rows.length === 0);
    if (shouldBeDefault) payload.is_default = true;

    let recordId: string;
    if (existing) {
        const updated = await adminClient.collection(PROVIDERS_COLLECTION).update(existing.id, payload);
        recordId = updated.id;
    } else {
        payload.created_by = options.actorEmail || '';
        if (!('is_default' in payload)) payload.is_default = false;
        const created = await adminClient.collection(PROVIDERS_COLLECTION).create(payload);
        recordId = created.id;
    }

    if (shouldBeDefault) {
        await Promise.all(
            rows
                .filter((row) => row.id !== recordId && row.is_default === true)
                .map((row) =>
                    adminClient.collection(PROVIDERS_COLLECTION).update(row.id, { is_default: false }).catch(() => null)
                )
        );
    }
    const refreshed = await adminClient.collection(PROVIDERS_COLLECTION).getOne(recordId);
    return toPublicProvider(refreshed as unknown as ProviderRow);
}

export async function deleteProvider(
    adminClient: PocketBase,
    accountEmail: string,
    providerId: string
): Promise<void> {
    const row = await getProviderRow(adminClient, accountEmail, providerId);
    await adminClient.collection(PROVIDERS_COLLECTION).delete(row.id);
}

export async function markProviderTested(
    adminClient: PocketBase,
    providerId: string,
    ok: boolean
): Promise<void> {
    if (providerId === 'environment') return;
    await adminClient
        .collection(PROVIDERS_COLLECTION)
        .update(providerId, { last_test_ok: ok, last_tested_at: new Date().toISOString() })
        .catch(() => null);
}

/** Build a throwaway provider config for "test before save" requests. */
export function providerFromInputForTest(
    adminClient: PocketBase,
    accountEmail: string,
    input: ValidatedProviderInput,
    env: NodeJS.ProcessEnv = process.env
): Promise<AiProviderConfig> {
    return (async () => {
        if (input.apiKey) {
            return {
                id: 'test',
                name: input.name,
                baseUrl: input.baseUrl,
                apiKey: input.apiKey,
                model: input.model,
                models: input.models ?? [],
                customHeaders: input.customHeaders ?? {},
                temperature: input.temperature ?? 0.3,
                maxTokens: input.maxTokens ?? 2_048,
                maxTokensParam: input.maxTokensParam ?? 'max_tokens',
                supportsTools: input.supportsTools !== false,
                enabled: true,
                isDefault: false,
                timeoutMs: 30_000,
                source: 'database',
            };
        }
        const rows = await listProviderRows(adminClient, accountEmail);
        const row = rows.find((candidate) => candidate.base_url === input.baseUrl && candidate.model === input.model);
        if (!row) throw new AiConfigError('Provide an API key to test this provider.', 'missing_api_key');
        const stored = rowToProvider(row, env);
        return {
            ...stored,
            name: input.name || stored.name,
            baseUrl: input.baseUrl,
            model: input.model,
            customHeaders: input.customHeaders ?? stored.customHeaders,
            timeoutMs: 30_000,
        };
    })();
}

/** True when at least one usable provider exists (status endpoint). */
export async function hasUsableProvider(
    adminClient: PocketBase,
    accountEmail: string,
    env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
    try {
        await resolveProviderForRequest(adminClient, accountEmail, undefined, env);
        return true;
    } catch {
        return false;
    }
}
