"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioTower, Loader2, ShieldCheck, Users, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
    resolveAudience,
    queueCampaign,
    getCampaignQueueSnapshot,
    renderMergeTags,
    type AudienceSegment,
    type BroadcastAudienceMember,
} from "@/lib/whatsapp-broadcast";
import { useAuth } from "@/contexts/AuthContext";

const SEGMENTS: { id: AudienceSegment; label: string; hint: string }[] = [
    { id: 'all_active', label: 'All Active Customers', hint: 'All opted-in WhatsApp numbers' },
    { id: 'vip_tiers', label: 'VIP Tiers (1000+ pts)', hint: 'Gold & Platinum cohorts' },
    { id: 'points_over_500', label: 'Unredeemed Points > 500', hint: 'Points-heavy customers' },
    { id: 'wholesale', label: 'Wholesale / B2B Buyers', hint: 'Wholesale customer type' },
];

const PRESETS: { label: string; template: string }[] = [
    {
        label: 'Festive Collection',
        template: 'Dear {{customer_name}}, ✨ our new festive collection has arrived! As a {{tier}} member you get first pick — reply to reserve your favourites.',
    },
    {
        label: 'Points Reminder',
        template: 'Hi {{first_name}}! ⭐ You have {{loyalty_points}} unredeemed loyalty points waiting. Visit us or reply here to redeem them on your next purchase.',
    },
    {
        label: 'New Arrivals',
        template: 'Namaste {{customer_name}} 🙏 Fresh stock of rings, chokers & jhumkas just landed at Luminila. Reply "MENU" to browse the latest pieces.',
    },
];

export interface BroadcastComposerModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Smart Staggered Broadcast composer (spec §11): segmentation, merge-tag
 * templates with live preview, anti-ban safeguards summary, and queueing.
 */
export function BroadcastComposerModal({ isOpen, onClose }: BroadcastComposerModalProps) {
    const { user } = useAuth();
    const [campaign, setCampaign] = useState('');
    const [segment, setSegment] = useState<AudienceSegment>('vip_tiers');
    const [template, setTemplate] = useState(PRESETS[0].template);
    const [audience, setAudience] = useState<BroadcastAudienceMember[]>([]);
    const [loadingAudience, setLoadingAudience] = useState(false);
    const [queueing, setQueueing] = useState(false);
    const [snapshot, setSnapshot] = useState<{ queued: number; sentToday: number } | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setLoadingAudience(true);

        resolveAudience(segment)
            .then((members) => {
                if (!cancelled) setAudience(members);
            })
            .catch((err) => {
                console.error('[composer] failed to load audience:', err);
                if (!cancelled) setAudience([]);
            })
            .finally(() => {
                if (!cancelled) setLoadingAudience(false);
            });

        getCampaignQueueSnapshot()
            .then((s) => {
                if (!cancelled) setSnapshot(s);
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };
    }, [isOpen, segment]);

    const preview = useMemo(
        () => renderMergeTags(
            template,
            audience[0] || { name: 'Priya Sharma', loyalty_points: 1420, total_spent: 45000, customer_type: 'retail' }
        ),
        [template, audience]
    );

    const handleQueue = async () => {
        const name = campaign.trim() || `Campaign ${new Date().toLocaleDateString('en-IN')}`;
        if (audience.length === 0) {
            toast.error('No reachable recipients in this segment');
            return;
        }
        setQueueing(true);
        try {
            const result = await queueCampaign({
                campaign: name,
                template,
                segment,
                createdBy: user?.id,
            });
            toast.success(
                `${result.queued} messages queued with 8–22s humanized stagger`,
                { description: 'Automated dispatch runs while the WhatsApp hub is active.' }
            );
            onClose();
        } catch (err) {
            toast.error((err as Error)?.message || 'Failed to queue campaign');
        } finally {
            setQueueing(false);
        }
    };

    const quotaBar = snapshot ? Math.min(100, Math.round((snapshot.sentToday / 150) * 100)) : 0;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-lg bg-card border-border max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <RadioTower size={16} className="text-amber-500" />
                        Smart Broadcast Campaign
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Anti-ban engine: personalized merge tags, 8–22s humanized stagger, 150/day quota, and STOP opt-out compliance.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3.5 py-1">
                    {/* Campaign Title */}
                    <div className="grid gap-1.5">
                        <Label htmlFor="bc-campaign" className="text-xs font-semibold">
                            Campaign Name
                        </Label>
                        <Input
                            id="bc-campaign"
                            value={campaign}
                            onChange={(e) => setCampaign(e.target.value)}
                            placeholder={`Diwali Blast ${new Date().getFullYear()}`}
                            className="h-8 text-xs"
                        />
                    </div>

                    {/* Audience Segment */}
                    <div className="grid gap-1.5">
                        <Label className="text-xs font-semibold flex items-center gap-1">
                            <Users size={12} />
                            Audience Segment
                        </Label>
                        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Audience Segments">
                            {SEGMENTS.map((s) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={segment === s.id}
                                    onClick={() => setSegment(s.id)}
                                    className={`rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-1 focus:ring-primary ${
                                        segment === s.id
                                            ? 'border-primary bg-primary/10 shadow-sm'
                                            : 'border-border hover:bg-muted/60'
                                    }`}
                                >
                                    <p className="text-[11px] font-bold text-foreground">{s.label}</p>
                                    <p className="text-[10px] text-muted-foreground">{s.hint}</p>
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>
                                {loadingAudience ? (
                                    <span className="flex items-center gap-1">
                                        <Loader2 size={10} className="animate-spin" /> Resolving opted-in audience…
                                    </span>
                                ) : (
                                    `${audience.length} reachable recipients`
                                )}
                            </span>
                            <span className="text-[10px] text-muted-foreground/80">STOP opt-outs auto-excluded</span>
                        </div>
                    </div>

                    {/* Template Composer */}
                    <div className="grid gap-1.5">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="bc-template" className="text-xs font-semibold">
                                Message Template
                            </Label>
                            <span className="text-[10px] text-muted-foreground">Presets:</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {PRESETS.map((p) => (
                                <button
                                    key={p.label}
                                    type="button"
                                    onClick={() => setTemplate(p.template)}
                                    className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-border bg-muted/30 hover:bg-muted transition-colors"
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <textarea
                            id="bc-template"
                            value={template}
                            onChange={(e) => setTemplate(e.target.value)}
                            rows={3}
                            aria-label="Message template text"
                            className="w-full rounded-md border border-border bg-muted/40 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                        />
                        <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                            <span>Merge tags:</span>
                            <code className="bg-muted px-1 rounded text-primary">{"{{customer_name}}"}</code>
                            <code className="bg-muted px-1 rounded text-primary">{"{{first_name}}"}</code>
                            <code className="bg-muted px-1 rounded text-primary">{"{{tier}}"}</code>
                            <code className="bg-muted px-1 rounded text-primary">{"{{loyalty_points}}"}</code>
                            <code className="bg-muted px-1 rounded text-primary">{"{{total_spent}}"}</code>
                        </div>

                        {/* Live Preview Bubble */}
                        <div className="rounded-lg bg-primary/5 border border-primary/20 p-2.5">
                            <div className="flex items-center gap-1 text-[10px] font-bold text-primary mb-1">
                                <Sparkles size={11} /> Sample Preview (Simulated Recipient)
                            </div>
                            <div className="text-[11px] leading-relaxed whitespace-pre-wrap text-foreground">
                                {preview}
                                {'\n\n_Reply STOP to opt out._'}
                            </div>
                        </div>
                    </div>

                    {/* Safeguards & Quota Progress */}
                    {snapshot && (
                        <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
                                <span className="flex items-center gap-1 font-medium text-foreground">
                                    <ShieldCheck size={13} className="text-emerald-500" /> Daily Marketing Quota
                                </span>
                                <span>{snapshot.sentToday} / 150 sent today</span>
                            </div>
                            <div
                                className="h-1.5 rounded-full bg-muted overflow-hidden"
                                role="progressbar"
                                aria-valuenow={snapshot.sentToday}
                                aria-valuemin={0}
                                aria-valuemax={150}
                            >
                                <div
                                    className="h-full bg-emerald-500 transition-all duration-300"
                                    style={{ width: `${quotaBar}%` }}
                                />
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground mt-1">
                                <span>Humanized 8–22s pacing per dispatch</span>
                                {snapshot.queued > 0 && (
                                    <span className="font-semibold text-amber-500">
                                        {snapshot.queued} already queued
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" size="sm" onClick={onClose} disabled={queueing}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleQueue}
                        disabled={queueing || audience.length === 0}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                    >
                        {queueing ? (
                            <>
                                <Loader2 size={14} className="animate-spin mr-1.5" />
                                Queueing…
                            </>
                        ) : (
                            <>
                                <RadioTower size={14} className="mr-1.5" />
                                Queue {audience.length} Message{audience.length === 1 ? '' : 's'}
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
