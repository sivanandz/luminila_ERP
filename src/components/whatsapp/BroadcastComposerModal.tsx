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
import {
    RadioTower,
    Loader2,
    ShieldCheck,
    Users,
    Sparkles,
    Megaphone,
    Radio,
    Check,
    Send,
} from "lucide-react";
import { toast } from "sonner";
import {
    resolveAudience,
    queueCampaign,
    getCampaignQueueSnapshot,
    renderMergeTags,
    type AudienceSegment,
    type BroadcastAudienceMember,
} from "@/lib/whatsapp-broadcast";
import { getAllChats, whatsappManager, type WPPChat } from "@/lib/whatsapp";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const COHORT_SEGMENTS: { id: AudienceSegment; label: string; hint: string }[] = [
    { id: 'all_active', label: 'All Active Customers', hint: 'All opted-in WhatsApp numbers' },
    { id: 'vip_tiers', label: 'VIP Tiers (1000+ pts)', hint: 'Gold & Platinum cohorts' },
    { id: 'points_over_500', label: 'Unredeemed Points > 500', hint: 'Points-heavy customers' },
    { id: 'wholesale', label: 'Wholesale / B2B Buyers', hint: 'Wholesale customer type' },
];

const COHORT_PRESETS: { label: string; template: string }[] = [
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

const ANNOUNCEMENT_PRESETS: { label: string; template: string }[] = [
    {
        label: 'Collection Drop',
        template: '✨ *Luminila Announcement* ✨\n\nOur latest festive handcrafted collection has just dropped! 🌟 Exclusive preview for our community members. Reply here to browse the catalog or reserve your favorite pieces before public release.',
    },
    {
        label: 'Showroom Showcase',
        template: '📢 *Community Alert: Showroom Showcase*\n\nVisit our flagship showroom this weekend for an exclusive exhibition of bridal choker sets, 925 sterling silver, and custom jewelry. Walk-in benefits apply for community members!',
    },
    {
        label: 'Fresh Stock Alert',
        template: '💎 *Fresh Inventory Drop Alert:*\n\nNew handcrafted antique jhumkas, solitaire cocktail rings, and lightweight gold necklaces have just arrived in stock. Limited units per design. Reply with the design name to reserve.',
    },
    {
        label: 'Holiday Hours',
        template: '🏮 *Holiday Store & Concierge Update:*\n\nOur showroom and live video shopping concierge will be open with extended festive hours this week (9:00 AM – 9:30 PM). Book your personalized video preview anytime!',
    },
];

export interface BroadcastComposerModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Smart Staggered Broadcast composer (spec §11):
 * - Direct broadcast to WhatsApp Community Announcements, Channels, and Groups
 * - Direct staggered anti-ban broadcast to Customer Cohorts with merge tags
 */
export function BroadcastComposerModal({ isOpen, onClose }: BroadcastComposerModalProps) {
    const { user } = useAuth();
    const [destinationType, setDestinationType] = useState<'community' | 'cohort'>('community');
    const [campaign, setCampaign] = useState('');
    const [segment, setSegment] = useState<AudienceSegment>('vip_tiers');
    const [template, setTemplate] = useState(ANNOUNCEMENT_PRESETS[0].template);

    // Cohort Audience
    const [audience, setAudience] = useState<BroadcastAudienceMember[]>([]);
    const [loadingAudience, setLoadingAudience] = useState(false);
    const [queueing, setQueueing] = useState(false);
    const [snapshot, setSnapshot] = useState<{ queued: number; sentToday: number } | null>(null);

    // Community / Channel / Group Destinations
    const [loadingChats, setLoadingChats] = useState(false);
    const [availableCommunities, setAvailableCommunities] = useState<WPPChat[]>([]);
    const [availableChannels, setAvailableChannels] = useState<WPPChat[]>([]);
    const [availableGroups, setAvailableGroups] = useState<WPPChat[]>([]);
    const [selectedCommunities, setSelectedCommunities] = useState<string[]>([]);
    const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
    const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
    const [sendingBroadcast, setSendingBroadcast] = useState(false);

    // Switch default template when destination mode changes
    const handleSwitchMode = (mode: 'community' | 'cohort') => {
        setDestinationType(mode);
        if (mode === 'community') {
            setTemplate(ANNOUNCEMENT_PRESETS[0].template);
        } else {
            setTemplate(COHORT_PRESETS[0].template);
        }
    };

    // Load available communities, channels, and groups
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setLoadingChats(true);

        getAllChats(whatsappManager.getSessionIdSafe())
            .then((chats) => {
                if (cancelled) return;
                const channels = chats.filter((c) => c.id.includes('@newsletter'));
                const communities = chats.filter((c) =>
                    Boolean(c.isCommunityAnnounce || c.isCommunity || (c.name || '').toLowerCase().includes('announcement') || (c.name || '').toLowerCase().includes('community'))
                );
                const groups = chats.filter((c) =>
                    (c.isGroup || c.id.includes('@g.us')) &&
                    !c.isCommunityAnnounce &&
                    !(c.name || '').toLowerCase().includes('announcement')
                );

                setAvailableChannels(channels);
                setAvailableCommunities(communities);
                setAvailableGroups(groups);

                // Auto-select communities and channels by default
                if (communities.length > 0) setSelectedCommunities(communities.map((c) => c.id));
                if (channels.length > 0) setSelectedChannels(channels.map((c) => c.id));
            })
            .catch((err) => {
                console.error('[composer] failed to discover chats:', err);
            })
            .finally(() => {
                if (!cancelled) setLoadingChats(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    // Load cohort audience if in cohort mode
    useEffect(() => {
        if (!isOpen || destinationType !== 'cohort') return;
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
    }, [isOpen, destinationType, segment]);

    const preview = useMemo(() => {
        if (destinationType === 'cohort') {
            return renderMergeTags(
                template,
                audience[0] || { name: 'Priya Sharma', loyalty_points: 1420, total_spent: 45000, customer_type: 'retail' }
            );
        }
        return template;
    }, [template, audience, destinationType]);

    const toggleCommunity = (id: string) => {
        setSelectedCommunities((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const toggleChannel = (id: string) => {
        setSelectedChannels((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const toggleGroup = (id: string) => {
        setSelectedGroups((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    // Dispatch directly to Community Announcements, Channels & Groups
    const handleSendCommunityBroadcast = async () => {
        const targets = Array.from(new Set([...selectedCommunities, ...selectedChannels, ...selectedGroups]));
        if (targets.length === 0) {
            toast.error('Please select at least 1 Community Announcement, Channel, or Group');
            return;
        }
        if (!template.trim()) {
            toast.error('Please enter an announcement message');
            return;
        }

        setSendingBroadcast(true);
        let sentCount = 0;
        const failed: string[] = [];

        try {
            for (const targetId of targets) {
                try {
                    const ok = await whatsappManager.sendMessage(targetId, template.trim());
                    if (ok) sentCount++;
                    else failed.push(targetId);
                } catch {
                    failed.push(targetId);
                }
            }

            if (sentCount > 0) {
                toast.success(
                    `Broadcast delivered to ${sentCount} destination${sentCount === 1 ? '' : 's'}!`,
                    { description: `${selectedCommunities.length} Community Announcements reached.` }
                );
                onClose();
            } else {
                toast.error('Failed to deliver announcement to selected chats');
            }
        } finally {
            setSendingBroadcast(false);
        }
    };

    // Queue for Cohort Customers (Anti-Ban Staggered)
    const handleQueueCohort = async () => {
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
    const totalCommunityTargets = selectedCommunities.length + selectedChannels.length + selectedGroups.length;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-xl bg-card border-border max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <RadioTower size={16} className="text-amber-500" />
                        WhatsApp Broadcast Campaign
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Broadcast announcements to WhatsApp Community Announcements, Channels, Groups, or opted-in customer lists.
                    </DialogDescription>
                </DialogHeader>

                {/* Destination Mode Selector Tabs */}
                <div className="flex bg-muted/60 p-1 rounded-xl gap-1 text-xs">
                    <button
                        type="button"
                        onClick={() => handleSwitchMode('community')}
                        className={cn(
                            "flex-1 py-1.5 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all",
                            destinationType === 'community'
                                ? "bg-amber-500 text-white shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Megaphone size={13} />
                        Community Announcements & Channels
                    </button>
                    <button
                        type="button"
                        onClick={() => handleSwitchMode('cohort')}
                        className={cn(
                            "flex-1 py-1.5 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all",
                            destinationType === 'cohort'
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Users size={13} />
                        Customer Cohorts (Anti-Ban)
                    </button>
                </div>

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
                            placeholder={`Announcement ${new Date().toLocaleDateString('en-IN')}`}
                            className="h-8 text-xs"
                        />
                    </div>

                    {/* MODE 1: COMMUNITY ANNOUNCEMENTS & CHANNELS */}
                    {destinationType === 'community' && (
                        <div className="space-y-3">
                            {/* 1. Community Announcements Card */}
                            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-1.5 font-bold text-amber-500 text-xs">
                                            <Megaphone size={14} className="text-amber-500" />
                                            Community Announcements ({availableCommunities.length})
                                        </div>
                                        <p className="text-[10px] text-muted-foreground">
                                            Official announcement broadcasts for WhatsApp Communities.
                                        </p>
                                    </div>
                                    {availableCommunities.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (selectedCommunities.length === availableCommunities.length) {
                                                    setSelectedCommunities([]);
                                                } else {
                                                    setSelectedCommunities(availableCommunities.map((c) => c.id));
                                                }
                                            }}
                                            className="text-[10px] text-amber-500 hover:underline font-semibold"
                                        >
                                            {selectedCommunities.length === availableCommunities.length ? "Deselect All" : "Select All"}
                                        </button>
                                    )}
                                </div>

                                {loadingChats ? (
                                    <div className="py-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
                                        <Loader2 size={12} className="animate-spin" /> Loading community channels…
                                    </div>
                                ) : availableCommunities.length === 0 ? (
                                    <p className="text-[11px] text-muted-foreground italic py-1">
                                        No community announcement channels found on this account.
                                    </p>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5 pt-1 max-h-32 overflow-y-auto">
                                        {availableCommunities.map((c) => {
                                            const isSelected = selectedCommunities.includes(c.id);
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => toggleCommunity(c.id)}
                                                    className={cn(
                                                        "px-2.5 py-1 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition-colors",
                                                        isSelected
                                                            ? "bg-amber-500/20 border-amber-500 text-amber-400 shadow-sm"
                                                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    <Megaphone size={11} /> {c.name}
                                                    {isSelected && <Check size={11} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* 2. WhatsApp Channels */}
                            {availableChannels.length > 0 && (
                                <div className="p-2.5 rounded-lg border border-border bg-card space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                                            <Radio size={12} className="text-violet-400" />
                                            WhatsApp Channels ({availableChannels.length})
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (selectedChannels.length === availableChannels.length) {
                                                    setSelectedChannels([]);
                                                } else {
                                                    setSelectedChannels(availableChannels.map((c) => c.id));
                                                }
                                            }}
                                            className="text-[10px] text-primary hover:underline font-medium"
                                        >
                                            {selectedChannels.length === availableChannels.length ? "Deselect All" : "Select All"}
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        {availableChannels.map((c) => {
                                            const isSelected = selectedChannels.includes(c.id);
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => toggleChannel(c.id)}
                                                    className={cn(
                                                        "px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-colors",
                                                        isSelected
                                                            ? "bg-violet-500/15 border-violet-500 text-violet-400"
                                                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    <Radio size={11} /> {c.name}
                                                    {isSelected && <Check size={11} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* 3. WhatsApp Groups */}
                            {availableGroups.length > 0 && (
                                <div className="p-2.5 rounded-lg border border-border bg-card space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                                            <Users size={12} className="text-sky-400" />
                                            WhatsApp Groups ({availableGroups.length})
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (selectedGroups.length === availableGroups.length) {
                                                    setSelectedGroups([]);
                                                } else {
                                                    setSelectedGroups(availableGroups.map((c) => c.id));
                                                }
                                            }}
                                            className="text-[10px] text-primary hover:underline font-medium"
                                        >
                                            {selectedGroups.length === availableGroups.length ? "Deselect All" : "Select All"}
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 pt-1 max-h-28 overflow-y-auto">
                                        {availableGroups.map((c) => {
                                            const isSelected = selectedGroups.includes(c.id);
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => toggleGroup(c.id)}
                                                    className={cn(
                                                        "px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-colors",
                                                        isSelected
                                                            ? "bg-sky-500/15 border-sky-500 text-sky-400"
                                                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    <Users size={11} /> {c.name}
                                                    {isSelected && <Check size={11} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* MODE 2: CUSTOMER COHORTS */}
                    {destinationType === 'cohort' && (
                        <div className="grid gap-1.5">
                            <Label className="text-xs font-semibold flex items-center gap-1">
                                <Users size={12} />
                                Audience Segment
                            </Label>
                            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Audience Segments">
                                {COHORT_SEGMENTS.map((s) => (
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
                    )}

                    {/* Template Composer */}
                    <div className="grid gap-1.5">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="bc-template" className="text-xs font-semibold">
                                Announcement Text
                            </Label>
                            <span className="text-[10px] text-muted-foreground">Preset Templates:</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {(destinationType === 'community' ? ANNOUNCEMENT_PRESETS : COHORT_PRESETS).map((p) => (
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
                            rows={4}
                            aria-label="Message template text"
                            className="w-full rounded-md border border-border bg-muted/40 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                        />
                        {destinationType === 'cohort' && (
                            <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                                <span>Merge tags:</span>
                                <code className="bg-muted px-1 rounded text-primary">{"{{customer_name}}"}</code>
                                <code className="bg-muted px-1 rounded text-primary">{"{{first_name}}"}</code>
                                <code className="bg-muted px-1 rounded text-primary">{"{{tier}}"}</code>
                                <code className="bg-muted px-1 rounded text-primary">{"{{loyalty_points}}"}</code>
                                <code className="bg-muted px-1 rounded text-primary">{"{{total_spent}}"}</code>
                            </div>
                        )}

                        {/* Live Preview Bubble */}
                        <div className="rounded-lg bg-primary/5 border border-primary/20 p-2.5">
                            <div className="flex items-center gap-1 text-[10px] font-bold text-primary mb-1">
                                <Sparkles size={11} /> WhatsApp Live Preview
                            </div>
                            <div className="text-[11px] leading-relaxed whitespace-pre-wrap text-foreground">
                                {preview}
                                {destinationType === 'cohort' && '\n\n_Reply STOP to opt out._'}
                            </div>
                        </div>
                    </div>

                    {/* Safeguards & Quota Progress (only for customer cohort dispatch) */}
                    {destinationType === 'cohort' && snapshot && (
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
                    <Button variant="outline" size="sm" onClick={onClose} disabled={queueing || sendingBroadcast}>
                        Cancel
                    </Button>
                    {destinationType === 'community' ? (
                        <Button
                            size="sm"
                            onClick={handleSendCommunityBroadcast}
                            disabled={sendingBroadcast || totalCommunityTargets === 0 || !template.trim()}
                            className="bg-amber-600 hover:bg-amber-500 text-white font-semibold"
                        >
                            {sendingBroadcast ? (
                                <>
                                    <Loader2 size={14} className="animate-spin mr-1.5" />
                                    Broadcasting…
                                </>
                            ) : (
                                <>
                                    <Megaphone size={14} className="mr-1.5" />
                                    Send Announcement ({totalCommunityTargets})
                                </>
                            )}
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            onClick={handleQueueCohort}
                            disabled={queueing || audience.length === 0 || !template.trim()}
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
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
