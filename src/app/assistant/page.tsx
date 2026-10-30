"use client";

/**
 * AI assistant surface.
 *
 * A thin renderer over `useAiChat()`: the harness owns the loop, tools,
 * approvals and persistence; this page only presents the transcript and the
 * approval boundary (provider settings live in Settings → AI Providers). All
 * mutating tools are approved here, never in the model.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    AlertTriangle,
    Bot,
    History,
    Loader2,
    MessageSquare,
    Plus,
    Send,
    Settings2,
    Sparkles,
    Square,
    Trash2,
} from 'lucide-react';
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useAiChat } from "@/hooks/use-ai-chat";
import { ChatMessage, StreamingBubble } from "@/components/assistant/ChatMessage";
import { LiveToolList } from "@/components/assistant/ToolActivity";
import { ApprovalCard } from "@/components/assistant/ApprovalCard";

const SUGGESTIONS = [
    'How were my sales in the last 7 days?',
    'Which products are low on stock?',
    'Show unpaid invoices and the outstanding amount.',
    'Who are my top customers by lifetime spend?',
];

export default function AssistantPage() {
    const { isAdmin } = useAuth();
    const router = useRouter();
    const chat = useAiChat();
    const [draft, setDraft] = useState('');
    const [historyOpen, setHistoryOpen] = useState(false);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const activeProvider = useMemo(
        () => chat.status?.providers.find((provider) => provider.id === chat.providerId),
        [chat.status, chat.providerId]
    );
    const activeProfile = useMemo(
        () => chat.status?.profiles.find((profile) => profile.id === chat.profileId),
        [chat.status, chat.profileId]
    );
    const canWrite = activeProfile?.allowWrites === true;

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [chat.messages, chat.streamText, chat.liveTools, chat.pendingApprovals]);

    const submit = () => {
        const text = draft.trim();
        if (!text || chat.streaming || !chat.configured) return;
        setDraft('');
        void chat.send(text);
        textareaRef.current?.focus();
    };

    const renderComposer = () => {
        if (!chat.configured) {
            return (
                <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                    Connect an OpenAI-compatible provider to start chatting.
                    {isAdmin && (
                        <Button size="sm" variant="outline" className="ml-2" onClick={() => router.push('/settings?tab=ai')}>
                            <Settings2 className="mr-1.5 size-3.5" />
                            Configure
                        </Button>
                    )}
                </div>
            );
        }
        return (
            <div className="rounded-xl border border-border/70 bg-card p-2 shadow-sm">
                <div className="flex items-end gap-2">
                    <Textarea
                        ref={textareaRef}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                submit();
                            }
                        }}
                        placeholder={
                            canWrite
                                ? 'Ask about your store. Writes pause for your approval.'
                                : 'Ask about sales, stock, customers, invoices or expenses…'
                        }
                        rows={2}
                        className="max-h-40 min-h-[2.75rem] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                        disabled={chat.streaming}
                    />
                    {chat.streaming ? (
                        <Button variant="outline" size="sm" onClick={chat.stop} aria-label="Stop generating">
                            <Square className="mr-1.5 size-3.5" />
                            Stop
                        </Button>
                    ) : (
                        <Button size="sm" onClick={submit} disabled={!draft.trim()}>
                            <Send className="mr-1.5 size-3.5" />
                            Send
                        </Button>
                    )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-0.5 pt-1 text-[10px] text-muted-foreground">
                    <span>
                        {chat.profileId === 'operator'
                            ? 'Operations profile: write actions require approval.'
                            : 'Analyst profile: read-only tools.'}
                        {' '}Enter sends, Shift+Enter adds a line.
                    </span>
                    {chat.liveMeta && <span className="font-mono">{chat.liveMeta.model}</span>}
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-full flex-col overflow-hidden">
            <Header
                title="AI Assistant"
                subtitle="OpenAI-compatible harness over your store data"
                action={
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setHistoryOpen(true)}>
                            <History className="mr-1.5 size-3.5" />
                            History
                        </Button>
                        <Button variant="outline" size="sm" onClick={chat.newConversation} disabled={chat.streaming}>
                            <Plus className="mr-1.5 size-3.5" />
                            New chat
                        </Button>
                        {isAdmin && (
                            <Button variant="outline" size="sm" onClick={() => router.push('/settings?tab=ai')}>
                                <Settings2 className="mr-1.5 size-3.5" />
                                Provider settings
                            </Button>
                        )}
                    </div>
                }
            />

            <div className="flex min-h-0 flex-1">
                <aside className="hidden w-60 shrink-0 flex-col border-r border-border/60 bg-muted/10 lg:flex">
                    <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground">
                        <span className="uppercase tracking-wide">Conversations</span>
                        {chat.conversationsLoading && <Loader2 className="size-3 animate-spin" />}
                    </div>
                    <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
                        {chat.conversations.length === 0 && (
                            <p className="px-2 py-3 text-xs text-muted-foreground">No conversations yet.</p>
                        )}
                        {chat.conversations.map((conversation) => (
                            <div
                                key={conversation.id}
                                className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${
                                    chat.activeConversationId === conversation.id
                                        ? 'bg-primary/10 text-foreground'
                                        : 'text-muted-foreground hover:bg-muted/50'
                                }`}
                            >
                                <button
                                    type="button"
                                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                    onClick={() => void chat.openConversation(conversation.id)}
                                    disabled={chat.streaming}
                                >
                                    <MessageSquare className="size-3.5 shrink-0" />
                                    <span className="truncate">{conversation.title}</span>
                                </button>
                                <button
                                    type="button"
                                    aria-label="Delete conversation"
                                    className="opacity-0 transition-opacity group-hover:opacity-100"
                                    onClick={() => void chat.removeConversation(conversation.id)}
                                >
                                    <Trash2 className="size-3 text-muted-foreground hover:text-red-500" />
                                </button>
                            </div>
                        ))}
                    </div>
                </aside>

                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-background/60 px-3 py-2">
                        <div className="flex items-center gap-1.5">
                            <Sparkles className="size-3.5 text-primary" />
                            <Select value={chat.profileId} onValueChange={(value) => value && chat.setProfileId(value)}>
                                <SelectTrigger size="sm" className="w-[10.5rem]">
                                    <SelectValue placeholder="Profile" />
                                </SelectTrigger>
                                <SelectContent>
                                    {(chat.status?.profiles ?? []).map((profile) => (
                                        <SelectItem key={profile.id} value={profile.id}>
                                            {profile.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {(chat.status?.providers.length ?? 0) > 0 && (
                            <Select
                                value={chat.providerId || undefined}
                                onValueChange={(value) => value && chat.setProviderId(value)}
                            >
                                <SelectTrigger size="sm" className="w-[11rem]">
                                    <SelectValue placeholder="Provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    {chat.status?.providers.map((provider) => (
                                        <SelectItem key={provider.id} value={provider.id}>
                                            {provider.name}
                                            {provider.model ? ` · ${provider.model}` : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <Badge variant={canWrite ? 'secondary' : 'outline'} className="text-[10px]">
                            {canWrite ? 'writes need approval' : 'read-only'}
                        </Badge>
                        {activeProvider?.source === 'environment' && (
                            <Badge variant="outline" className="text-[10px]">environment provider</Badge>
                        )}
                        {chat.status && !chat.status.configured && (
                            <Badge variant="destructive" className="text-[10px]">no provider configured</Badge>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 sm:p-4">
                        <div className="mx-auto max-w-3xl space-y-3 pb-2">
                            <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
                                <DialogContent className="max-h-[80vh] max-w-md overflow-y-auto">
                                    <DialogHeader>
                                        <DialogTitle className="text-sm">Conversations</DialogTitle>
                                        <DialogDescription className="text-xs">
                                            Select a previous conversation to continue it.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-1">
                                        {chat.conversations.length === 0 && (
                                            <p className="text-xs text-muted-foreground">No conversations yet.</p>
                                        )}
                                        {chat.conversations.map((conversation) => (
                                            <button
                                                key={conversation.id}
                                                type="button"
                                                className="flex w-full items-center gap-2 rounded-lg border border-border/60 px-2.5 py-2 text-left text-xs hover:bg-muted/40"
                                                onClick={() => {
                                                    setHistoryOpen(false);
                                                    void chat.openConversation(conversation.id);
                                                }}
                                            >
                                                <MessageSquare className="size-3.5 shrink-0" />
                                                <span className="truncate">{conversation.title}</span>
                                            </button>
                                        ))}
                                    </div>
                                </DialogContent>
                            </Dialog>

                            {chat.messages.length === 0 && !chat.streaming && (
                                <Card className="border-border/70 bg-card/60">
                                    <CardContent className="space-y-3 py-6 text-center">
                                        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10">
                                            <Bot className="size-5 text-primary" />
                                        </div>
                                        <div>
                                            <h2 className="text-sm font-semibold">Ask your store anything</h2>
                                            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                                                Answers come from live reads of your products, sales, customers, invoices
                                                and expenses. In the Operations profile the assistant can create a customer
                                                or append an order note after you approve it.
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap justify-center gap-1.5">
                                            {SUGGESTIONS.map((suggestion) => (
                                                <Button
                                                    key={suggestion}
                                                    variant="outline"
                                                    size="sm"
                                                    className="text-xs"
                                                    disabled={!chat.configured}
                                                    onClick={() => {
                                                        setDraft('');
                                                        void chat.send(suggestion);
                                                    }}
                                                >
                                                    {suggestion}
                                                </Button>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {chat.messages.map((message) => (
                                <ChatMessage key={message.id} message={message} />
                            ))}

                            {chat.streaming && (
                                <StreamingBubble text={chat.streamText} reasoning={chat.streamReasoning}>
                                    <LiveToolList tools={chat.liveTools} />
                                </StreamingBubble>
                            )}

                            {chat.error && (
                                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
                                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                    <span className="flex-1">{chat.error}</span>
                                    <button type="button" className="underline" onClick={chat.clearError}>
                                        dismiss
                                    </button>
                                </div>
                            )}

                            <div ref={bottomRef} />
                        </div>
                    </div>

                    {chat.pendingApprovals.length > 0 && (
                        <div className="mx-auto w-full max-w-3xl px-3 pb-2">
                            <ApprovalCard
                                approvals={chat.pendingApprovals}
                                disabled={chat.streaming}
                                onDecision={(approved) => void chat.decideApprovals(approved)}
                            />
                        </div>
                    )}

                    <div className="border-t border-border/60 bg-background/80 px-3 py-2.5 sm:px-4">
                        <div className="mx-auto max-w-3xl">
                            {chat.statusLoading ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Loader2 className="size-3.5 animate-spin" /> Checking AI configuration…
                                </div>
                            ) : (
                                renderComposer()
                            )}
                            {!isAdmin && !chat.configured && !chat.statusLoading && (
                                <p className="mt-1.5 text-[10px] text-muted-foreground">
                                    An administrator can connect an OpenAI-compatible provider in Settings → AI Providers.
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
