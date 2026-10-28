"use client";

/**
 * AI provider management, rendered inside Settings → AI Providers.
 *
 * Admin-only surface (the routes re-authorize server-side). Deliberately never
 * receives stored API keys: the list shows "key set" and the form treats a blank
 * key field as "keep the existing key". Supports multiple providers, each with
 * its own model catalog; exactly one provider is the default for new turns.
 */

import { useCallback, useEffect, useState } from 'react';
import {
    CheckCircle2,
    KeyRound,
    Loader2,
    Pencil,
    Plug,
    Plus,
    RefreshCw,
    Star,
    Trash2,
    X,
    XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    deleteAiProvider,
    listAiProviderModels,
    listAiProviders,
    saveAiProvider,
    testAiProvider,
} from '@/lib/ai-client';
import type { AiProviderInput, AiProviderPublic } from '@/lib/ai/types';

interface ProviderForm {
    name: string;
    baseUrl: string;
    model: string;
    apiKey: string;
    temperature: string;
    maxTokens: string;
    supportsTools: boolean;
    enabled: boolean;
    isDefault: boolean;
}

const EMPTY_FORM: ProviderForm = {
    name: '',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    apiKey: '',
    temperature: '0.3',
    maxTokens: '2048',
    supportsTools: true,
    enabled: true,
    isDefault: false,
};

export function AiProvidersSettings() {
    const [providers, setProviders] = useState<AiProviderPublic[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
    const [models, setModels] = useState<string[]>([]);
    const [modelDraft, setModelDraft] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [testMessage, setTestMessage] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            setProviders(await listAiProviders());
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not load providers.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const toInput = (): AiProviderInput => {
        const temperature = Number(form.temperature);
        const maxTokens = Number(form.maxTokens);
        return {
            name: form.name.trim(),
            baseUrl: form.baseUrl.trim(),
            model: form.model.trim(),
            models,
            ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
            ...(Number.isFinite(temperature) ? { temperature } : {}),
            ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens: Math.trunc(maxTokens) } : {}),
            supportsTools: form.supportsTools,
            enabled: form.enabled,
            ...(form.isDefault ? { isDefault: true } : {}),
        };
    };

    const resetForm = () => {
        setShowForm(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
        setModels([]);
        setModelDraft('');
        setTestMessage(null);
    };

    const startCreate = () => {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setModels([]);
        setModelDraft('');
        setTestMessage(null);
        setShowForm(true);
    };

    const startEdit = (provider: AiProviderPublic) => {
        if (provider.source === 'environment') {
            toast.error('This provider is configured through environment variables.');
            return;
        }
        setEditingId(provider.id);
        setForm({
            name: provider.name,
            baseUrl: provider.baseUrl,
            model: provider.model,
            apiKey: '',
            temperature: String(provider.temperature ?? 0.3),
            maxTokens: String(provider.maxTokens ?? 2048),
            supportsTools: provider.supportsTools !== false,
            enabled: provider.enabled !== false,
            isDefault: provider.isDefault,
        });
        setModels(provider.models ?? []);
        setModelDraft('');
        setTestMessage(null);
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) {
            toast.error('Name, base URL and model are required.');
            return;
        }
        setBusy('save');
        try {
            await saveAiProvider(toInput(), editingId ?? undefined);
            toast.success(editingId ? 'Provider updated.' : 'Provider added.');
            resetForm();
            await reload();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not save the provider.');
        } finally {
            setBusy(null);
        }
    };

    const handleDelete = async (provider: AiProviderPublic) => {
        if (provider.source === 'environment') {
            toast.error('The environment provider is configured outside the app.');
            return;
        }
        if (!window.confirm(`Remove the provider "${provider.name}"? Conversations keep their history.`)) return;
        setBusy(`delete:${provider.id}`);
        try {
            await deleteAiProvider(provider.id);
            toast.success('Provider removed.');
            if (editingId === provider.id) resetForm();
            await reload();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not remove the provider.');
        } finally {
            setBusy(null);
        }
    };

    const handleSetDefault = async (provider: AiProviderPublic) => {
        setBusy(`default:${provider.id}`);
        try {
            await saveAiProvider(
                {
                    name: provider.name,
                    baseUrl: provider.baseUrl,
                    model: provider.model,
                    models: provider.models,
                    temperature: provider.temperature,
                    maxTokens: provider.maxTokens,
                    supportsTools: provider.supportsTools,
                    enabled: true,
                    isDefault: true,
                },
                provider.id
            );
            toast.success(`${provider.name} is now the default provider.`);
            await reload();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not set the default provider.');
        } finally {
            setBusy(null);
        }
    };

    const handleTestRow = async (provider: AiProviderPublic) => {
        setBusy(`test:${provider.id}`);
        try {
            const result = await testAiProvider({ id: provider.id });
            if (result.ok) {
                toast.success(`${provider.name} connected in ${result.latencyMs} ms.`);
                await reload();
            } else {
                toast.error(result.error ?? 'Provider connection failed.');
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Provider connection failed.');
        } finally {
            setBusy(null);
        }
    };

    const addModel = (value: string) => {
        const model = value.trim();
        if (!model) return;
        setModels((current) => (current.includes(model) ? current : [...current, model]));
        setForm((current) => ({ ...current, model: current.model.trim() ? current.model : model }));
        setModelDraft('');
    };

    const handleTestForm = async () => {
        setBusy('test');
        setTestMessage(null);
        try {
            const result = await testAiProvider(
                editingId && !form.apiKey.trim() ? { id: editingId } : { provider: toInput() }
            );
            if (result.ok) {
                setTestMessage(
                    `Connected in ${result.latencyMs} ms${result.models?.length ? ` · ${result.models.length} models` : ''}.`
                );
                const discovered = result.models ?? [];
                if (discovered.length > 0) {
                    setModels((current) => Array.from(new Set([...current, ...discovered])));
                }
                toast.success('Provider connection works.');
            } else {
                setTestMessage(result.error ?? 'Connection failed.');
                toast.error(result.error ?? 'Provider connection failed.');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Provider connection failed.';
            setTestMessage(message);
            toast.error(message);
        } finally {
            setBusy(null);
        }
    };

    const handleFetchModels = async () => {
        setBusy('models');
        try {
            const found = await listAiProviderModels(
                editingId && !form.apiKey.trim() ? { id: editingId } : { provider: toInput() }
            );
            setModels((current) => Array.from(new Set([...current, ...found])));
            toast.success(found.length > 0 ? `${found.length} models found.` : 'The provider returned no models.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not list models.');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="rounded-xl border border-border bg-background p-6 transition-colors hover:border-primary/30">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="text-lg font-bold text-foreground">Configured providers</h3>
                        <p className="text-sm text-muted-foreground">
                            Any OpenAI-compatible endpoint works. The default provider is used for new AI Assistant turns.
                        </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={startCreate} disabled={busy !== null}>
                        <Plus className="mr-1.5 size-3.5" />
                        Add provider
                    </Button>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> Loading providers…
                    </div>
                ) : providers.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
                        <Plug className="mx-auto mb-2 size-6 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                            No provider configured yet. Add an OpenAI-compatible endpoint to start using the assistant.
                        </p>
                    </div>
                ) : (
                    <ul className="space-y-3">
                        {providers.map((provider) => (
                            <li
                                key={provider.id}
                                className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 ${provider.enabled === false ? 'opacity-70' : ''}`}
                            >
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="truncate text-sm font-semibold">{provider.name}</span>
                                        {provider.isDefault && <Badge variant="secondary" className="text-[10px]">default</Badge>}
                                        {provider.enabled === false && <Badge variant="outline" className="text-[10px]">disabled</Badge>}
                                        {provider.source === 'environment' && (
                                            <Badge variant="outline" className="text-[10px]">env</Badge>
                                        )}
                                        {provider.hasApiKey ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
                                                <KeyRound className="size-3" /> key set
                                            </span>
                                        ) : (
                                            <span className="text-[10px] text-muted-foreground">no key</span>
                                        )}
                                        {provider.lastTestOk === true && <CheckCircle2 className="size-3.5 text-emerald-500" />}
                                        {provider.lastTestOk === false && <XCircle className="size-3.5 text-red-500" />}
                                    </div>
                                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                                        {provider.baseUrl} · {provider.model}
                                        {provider.models.length > 0 ? ` · ${provider.models.length} models` : ''}
                                    </p>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                                    {provider.source !== 'environment' ? (
                                        <>
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                onClick={() => handleTestRow(provider)}
                                                disabled={busy !== null}
                                                title="Test connection"
                                            >
                                                {busy === `test:${provider.id}` ? (
                                                    <Loader2 className="mr-1 size-3 animate-spin" />
                                                ) : (
                                                    <Plug className="mr-1 size-3" />
                                                )}
                                                Test
                                            </Button>
                                            {!provider.isDefault && (
                                                <Button
                                                    size="xs"
                                                    variant="ghost"
                                                    onClick={() => handleSetDefault(provider)}
                                                    disabled={busy !== null}
                                                >
                                                    <Star className="mr-1 size-3" />
                                                    Make default
                                                </Button>
                                            )}
                                            <Button size="xs" variant="outline" onClick={() => startEdit(provider)} disabled={busy !== null}>
                                                <Pencil className="mr-1 size-3" />
                                                Edit
                                            </Button>
                                            <Button
                                                size="icon-xs"
                                                variant="ghost"
                                                aria-label={`Remove ${provider.name}`}
                                                onClick={() => handleDelete(provider)}
                                                disabled={busy !== null}
                                            >
                                                {busy === `delete:${provider.id}` ? (
                                                    <Loader2 className="size-3 animate-spin" />
                                                ) : (
                                                    <Trash2 className="size-3" />
                                                )}
                                            </Button>
                                        </>
                                    ) : (
                                        <span className="text-[10px] text-muted-foreground">
                                            managed by server environment variables
                                        </span>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}

                <p className="mt-4 text-[11px] text-muted-foreground">
                    Examples: <code>https://api.openai.com/v1</code>, <code>https://api.deepseek.com/v1</code>,{' '}
                    <code>https://opencode.ai/inference/go/v1</code>, <code>http://127.0.0.1:11434/v1</code> (Ollama).
                    For OpenCode Go, the required routing header is added automatically; only Chat-Completions models work.
                </p>
            </div>

            {showForm && (
                <div className="rounded-xl border border-primary/30 bg-background p-6">
                    <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-lg font-bold text-foreground">
                            {editingId ? 'Edit provider' : 'New provider'}
                        </h3>
                        <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={resetForm} disabled={busy !== null}>
                            <X className="size-4" />
                        </Button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="ai-settings-name">Display name</Label>
                            <Input
                                id="ai-settings-name"
                                value={form.name}
                                placeholder="OpenCode Go / My provider"
                                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="ai-settings-model">Default model</Label>
                            <Input
                                id="ai-settings-model"
                                value={form.model}
                                placeholder="deepseek-v4.1-flash / gpt-4.1-mini / llama3.1"
                                list="ai-settings-models"
                                onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                            />
                            <datalist id="ai-settings-models">
                                {models.map((model) => (
                                    <option key={model} value={model} />
                                ))}
                            </datalist>
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label htmlFor="ai-settings-base-url">Base URL (OpenAI-compatible)</Label>
                            <Input
                                id="ai-settings-base-url"
                                value={form.baseUrl}
                                placeholder="https://api.openai.com/v1"
                                onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
                            />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label htmlFor="ai-settings-key">API key</Label>
                            <Input
                                id="ai-settings-key"
                                type="password"
                                autoComplete="off"
                                value={form.apiKey}
                                placeholder={editingId ? 'Leave blank to keep the stored key' : 'sk-… (optional for local servers)'}
                                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                            />
                            <p className="text-[11px] text-muted-foreground">
                                Encrypted on the server (AES-256-GCM) and never returned to the browser.
                            </p>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="ai-settings-temperature">Temperature</Label>
                            <Input
                                id="ai-settings-temperature"
                                type="number"
                                min="0"
                                max="2"
                                step="0.1"
                                value={form.temperature}
                                onChange={(event) => setForm((current) => ({ ...current, temperature: event.target.value }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="ai-settings-max-tokens">Max tokens</Label>
                            <Input
                                id="ai-settings-max-tokens"
                                type="number"
                                min="1"
                                max="200000"
                                step="1"
                                value={form.maxTokens}
                                onChange={(event) => setForm((current) => ({ ...current, maxTokens: event.target.value }))}
                            />
                        </div>
                    </div>

                    <div className="mt-5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <Label>Model catalog</Label>
                            <div className="flex items-center gap-2">
                                <Button size="xs" variant="outline" onClick={handleFetchModels} disabled={busy !== null}>
                                    {busy === 'models' ? (
                                        <Loader2 className="mr-1 size-3 animate-spin" />
                                    ) : (
                                        <RefreshCw className="mr-1 size-3" />
                                    )}
                                    Fetch from provider
                                </Button>
                                <div className="flex items-center gap-1">
                                    <Input
                                        value={modelDraft}
                                        placeholder="model id"
                                        className="h-7 w-36 text-xs"
                                        onChange={(event) => setModelDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                addModel(modelDraft);
                                            }
                                        }}
                                    />
                                    <Button size="xs" variant="outline" onClick={() => addModel(modelDraft)} disabled={!modelDraft.trim()}>
                                        Add
                                    </Button>
                                </div>
                            </div>
                        </div>
                        {models.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground">
                                No models listed yet. Fetch them from the provider or add ids manually; the catalog powers the
                                model picker on the assistant page.
                            </p>
                        ) : (
                            <div className="flex flex-wrap gap-1.5">
                                {models.map((model) => (
                                    <span
                                        key={model}
                                        className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-[11px]"
                                    >
                                        {model}
                                        <button
                                            type="button"
                                            aria-label={`Remove ${model}`}
                                            className="text-muted-foreground hover:text-foreground"
                                            onClick={() => setModels((current) => current.filter((entry) => entry !== model))}
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-6">
                        <div className="flex items-center gap-2">
                            <Switch
                                id="ai-settings-tools"
                                checked={form.supportsTools}
                                onCheckedChange={(checked) => setForm((current) => ({ ...current, supportsTools: checked }))}
                            />
                            <Label htmlFor="ai-settings-tools">Supports tool calling</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                id="ai-settings-enabled"
                                checked={form.enabled}
                                onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))}
                            />
                            <Label htmlFor="ai-settings-enabled">Enabled</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                id="ai-settings-default"
                                checked={form.isDefault}
                                onCheckedChange={(checked) => setForm((current) => ({ ...current, isDefault: checked }))}
                            />
                            <Label htmlFor="ai-settings-default">Set as default provider</Label>
                        </div>
                    </div>

                    {testMessage && (
                        <p className="mt-4 text-xs text-muted-foreground" role="status">
                            {testMessage}
                        </p>
                    )}

                    <div className="mt-5 flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={handleSave} disabled={busy !== null}>
                            {busy === 'save' ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                            Save provider
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleTestForm} disabled={busy !== null}>
                            {busy === 'test' ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            ) : (
                                <Plug className="mr-1.5 size-3.5" />
                            )}
                            Test connection
                        </Button>
                        <Button size="sm" variant="ghost" onClick={resetForm} disabled={busy !== null}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
