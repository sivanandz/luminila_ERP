"use client";

/** Chat bubble for one persisted transcript message. */

import { Bot, User, AlertTriangle } from 'lucide-react';
import { Markdown } from './Markdown';
import { ToolResultCard, riskLabel } from './ToolActivity';
import type { AiConversationMessage } from '@/lib/ai/types';

function formatTime(iso?: string): string {
    if (!iso) return '';
    try {
        return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
    } catch {
        return '';
    }
}

export function ChatMessage({ message }: { message: AiConversationMessage }) {
    if (message.role === 'system') {
        const isError = message.kind !== 'info';
        return (
            <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                    isError
                        ? 'border-red-500/30 bg-red-500/5 text-red-500'
                        : 'border-border/60 bg-muted/30 text-muted-foreground'
                }`}
            >
                <AlertTriangle className={`mt-0.5 size-3.5 shrink-0 ${isError ? '' : 'opacity-70'}`} />
                <span>{message.text}</span>
            </div>
        );
    }

    if (message.role === 'tool') {
        if (!message.toolResult) return null;
        return <ToolResultCard result={message.toolResult} />;
    }

    const isUser = message.role === 'user';
    return (
        <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
            <div
                className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
                    isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                }`}
            >
                {isUser ? <User className="size-3.5" /> : <Bot className="size-4" />}
            </div>
            <div className={`min-w-0 max-w-[min(46rem,100%)] ${isUser ? 'text-right' : ''}`}>
                <div
                    className={`rounded-xl px-3.5 py-2.5 text-sm ${
                        isUser
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border/70 bg-card text-card-foreground'
                    }`}
                >
                    {isUser ? (
                        <p className="whitespace-pre-wrap text-left">{message.text}</p>
                    ) : (
                        <>
                            {message.reasoning && (
                                <details className="mb-2 rounded-lg bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                                    <summary className="cursor-pointer select-none">Reasoning</summary>
                                    <p className="mt-1 whitespace-pre-wrap">{message.reasoning}</p>
                                </details>
                            )}
                            {message.text ? (
                                <Markdown content={message.text} />
                            ) : (
                                <span className="text-muted-foreground">No text response.</span>
                            )}
                        </>
                    )}
                </div>
                {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {message.toolCalls.map((call) => (
                            <span
                                key={call.id}
                                className="rounded-md border border-border/60 bg-muted/30 px-2 py-1 font-mono text-[10px] text-muted-foreground"
                                title={call.arguments}
                            >
                                {call.name}
                            </span>
                        ))}
                    </div>
                )}
                {message.createdAt && (
                    <div className="mt-1 text-[10px] text-muted-foreground">{formatTime(message.createdAt)}</div>
                )}
            </div>
        </div>
    );
}

export function StreamingBubble({
    text,
    reasoning,
    children,
}: {
    text: string;
    reasoning: string;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex gap-2.5">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <Bot className="size-4" />
            </div>
            <div className="min-w-0 max-w-[min(46rem,100%)] flex-1">
                <div className="rounded-xl border border-border/70 bg-card px-3.5 py-2.5">
                    {reasoning && (
                        <details className="mb-2 rounded-lg bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                            <summary className="cursor-pointer select-none">Thinking…</summary>
                            <p className="mt-1 whitespace-pre-wrap">{reasoning}</p>
                        </details>
                    )}
                    {text ? (
                        <Markdown content={text} />
                    ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                            Working…
                        </span>
                    )}
                    {children && <div className="mt-2 space-y-1.5">{children}</div>}
                </div>
            </div>
        </div>
    );
}

export { riskLabel };
