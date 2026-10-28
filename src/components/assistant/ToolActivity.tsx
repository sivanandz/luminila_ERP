"use client";

/** Tool-call presentation for the assistant transcript and live streaming. */

import {
    AlertTriangle,
    CheckCircle2,
    Loader2,
    ShieldX,
    Wrench,
    XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AiToolResultView } from '@/lib/ai/types';
import type { LiveToolCall } from '@/hooks/use-ai-chat';

const RISK_LABEL: Record<string, string> = { low: 'low risk', medium: 'changes data', high: 'high risk' };

export function riskLabel(risk: string): string {
    return RISK_LABEL[risk] ?? risk;
}

function statusIcon(status: 'running' | 'ok' | 'error' | 'denied') {
    if (status === 'running') return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
    if (status === 'ok') return <CheckCircle2 className="size-3.5 text-emerald-500" />;
    if (status === 'denied') return <ShieldX className="size-3.5 text-amber-500" />;
    return <XCircle className="size-3.5 text-red-500" />;
}

export function ToolResultCard({ result }: { result: AiToolResultView }) {
    return (
        <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs">
            <span className="mt-0.5">{statusIcon(result.status)}</span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-[11px] text-foreground">{result.name}</span>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        tool
                    </Badge>
                    {typeof result.durationMs === 'number' && (
                        <span className="text-muted-foreground">{result.durationMs} ms</span>
                    )}
                </div>
                {result.summary && <p className="mt-1 text-muted-foreground">{result.summary}</p>}
                {result.error && <p className="mt-1 text-red-500">{result.error}</p>}
            </div>
        </div>
    );
}

export function LiveToolList({ tools }: { tools: LiveToolCall[] }) {
    if (tools.length === 0) return null;
    return (
        <div className="space-y-1.5">
            {tools.map((tool) => (
                <div
                    key={tool.callId}
                    className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs"
                >
                    <span className="mt-0.5">{statusIcon(tool.status)}</span>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <Wrench className="size-3 text-muted-foreground" />
                            <span className="font-mono text-[11px]">{tool.name}</span>
                            {tool.status === 'running' && (
                                <span className="text-muted-foreground">running…</span>
                            )}
                        </div>
                        {tool.summary && <p className="mt-1 text-muted-foreground">{tool.summary}</p>}
                        {tool.error && <p className="mt-1 text-red-500">{tool.error}</p>}
                    </div>
                </div>
            ))}
        </div>
    );
}

export function ToolErrorHint() {
    return (
        <div className="flex items-center gap-2 text-xs text-amber-600">
            <AlertTriangle className="size-3.5" />
            The tool returned an error; the assistant was told about it.
        </div>
    );
}
