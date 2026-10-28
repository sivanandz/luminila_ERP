"use client";

/** Approval card for write tools paused by the agent loop. */

import { useState } from 'react';
import { CheckCircle2, Circle, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { riskLabel } from './ToolActivity';
import type { AiPendingApproval } from '@/lib/ai/types';

interface ApprovalCardProps {
    approvals: AiPendingApproval[];
    disabled?: boolean;
    onDecision: (approvedCallIds: string[]) => void;
}

export function ApprovalCard({ approvals, disabled, onDecision }: ApprovalCardProps) {
    const approvalKey = approvals.map((approval) => approval.callId).join('|');
    const [selected, setSelected] = useState<Set<string>>(() => new Set(approvals.map((approval) => approval.callId)));

    // A resumed turn can surface a different pending set; never leave stale ids
    // selected (the server would safely deny them, but the UI should be honest).
    const [lastApprovalKey, setLastApprovalKey] = useState(approvalKey);
    if (lastApprovalKey !== approvalKey) {
        setLastApprovalKey(approvalKey);
        setSelected(new Set(approvals.map((approval) => approval.callId)));
    }

    if (approvals.length === 0) return null;

    const toggle = (callId: string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(callId)) next.delete(callId);
            else next.add(callId);
            return next;
        });
    };

    const approveSelected = () => {
        onDecision([...selected]);
        setSelected(new Set());
    };
    const denyAll = () => {
        onDecision([]);
        setSelected(new Set());
    };

    return (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-amber-500" />
                <h3 className="text-sm font-semibold">Approval required</h3>
                <Badge variant="outline" className="text-[10px]">
                    write action
                </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
                The assistant wants to change store data. Review each action; nothing runs until you approve it.
            </p>
            <ul className="mt-2.5 space-y-1.5">
                {approvals.map((approval) => {
                    const isSelected = selected.has(approval.callId);
                    return (
                        <li key={approval.callId}>
                            <button
                                type="button"
                                onClick={() => toggle(approval.callId)}
                                disabled={disabled}
                                className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                                    isSelected
                                        ? 'border-primary/40 bg-primary/5'
                                        : 'border-border/60 bg-background/40 hover:bg-muted/40'
                                }`}
                            >
                                {isSelected ? (
                                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                                ) : (
                                    <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                                )}
                                <span className="min-w-0 flex-1">
                                    <span className="flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-[11px]">{approval.name}</span>
                                        <span className="text-muted-foreground">{riskLabel(approval.risk)}</span>
                                    </span>
                                    <details className="mt-1">
                                        <summary className="cursor-pointer text-[10px] text-muted-foreground">
                                            Arguments
                                        </summary>
                                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">
                                            {approval.arguments || '{}'}
                                        </pre>
                                    </details>
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={approveSelected} disabled={disabled || selected.size === 0}>
                    <ShieldCheck className="mr-1.5 size-3.5" />
                    Approve selected ({selected.size})
                </Button>
                <Button size="sm" variant="outline" onClick={denyAll} disabled={disabled}>
                    <XCircle className="mr-1.5 size-3.5" />
                    Deny all
                </Button>
            </div>
        </div>
    );
}
