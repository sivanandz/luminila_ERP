"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, X, Send, Search, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { whatsappManager, getAllChats, getChatMessages, markAsRead, type WPPChat, type WPPMessage } from "@/lib/whatsapp";
import {
    getStoredChats,
    sendStaffMessage,
    broadcastAddToPOS,
    extractVariantHints,
    queueLabelPrint,
    type ContactType,
} from "@/lib/whatsapp-crm";
import { MessageActionMenu } from "@/components/whatsapp/MessageActionMenu";
import { VendorIngestionModal, AddExistingInventoryModal } from "@/components/whatsapp/VendorIngestionModal";
import { useLongPress } from "@/hooks/use-long-press";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

/**
 * Global Floating Slide-Over Chat Drawer (spec §3.2).
 * Reachable from ANY route so staff can check conversations while
 * inspecting stock on /inventory or verifying a PO in /purchase.
 * Includes full right-click / long-press Context Action Engine (spec §8 / §8.4).
 */
export function WhatsAppDrawer() {
    const pathname = usePathname();
    const { user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [chats, setChats] = useState<WPPChat[]>([]);
    const [contactTypes, setContactTypes] = useState<Record<string, ContactType>>({});
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(false);
    const [activeChat, setActiveChat] = useState<WPPChat | null>(null);
    const [messages, setMessages] = useState<WPPMessage[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Context Action Engine state (spec §8)
    const [actionMenu, setActionMenu] = useState<{
        isOpen: boolean;
        message: WPPMessage | null;
        position: { x: number; y: number } | null;
    }>({ isOpen: false, message: null, position: null });
    const [vendorIngestMsg, setVendorIngestMsg] = useState<string | null>(null);
    const [addInventoryMsg, setAddInventoryMsg] = useState<string | null>(null);

    // Long-press gesture on the drawer transcript
    const { pressing: longPressing, handlers: longPressHandlers } = useLongPress((pos) => {
        const el = document.elementFromPoint(pos.x, pos.y)?.closest('[data-msg-id]') as HTMLElement | null;
        const msgId = el?.getAttribute('data-msg-id');
        const msg = messages.find((m) => m.id === msgId);
        if (msg) setActionMenu({ isOpen: true, message: msg, position: pos });
    });

    // Hide on the dedicated hub, auth and first-run screens
    const hidden = pathname?.startsWith('/whatsapp') || pathname?.startsWith('/login') || pathname?.startsWith('/setup');

    const loadChats = useCallback(async () => {
        setLoading(true);
        try {
            const [sidecarChats, stored] = await Promise.all([
                getAllChats(whatsappManager.getSessionIdSafe()),
                getStoredChats(),
            ]);
            const typeMap: Record<string, ContactType> = {};
            for (const s of stored) typeMap[s.chat_id] = s.contact_type as ContactType;
            setContactTypes(typeMap);
            setChats(sidecarChats.filter((c) => !c.isGroup).sort((a, b) => b.timestamp - a.timestamp));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) loadChats();
    }, [isOpen, loadChats]);

    const openConversation = async (chat: WPPChat) => {
        setActiveChat(chat);
        setMessages([]);
        setLoadingMessages(true);
        try {
            const msgs = await getChatMessages(whatsappManager.getSessionIdSafe(), chat.id, 30);
            setMessages(msgs);
            if (chat.unreadCount > 0) {
                markAsRead(whatsappManager.getSessionIdSafe(), chat.id).catch(() => {});
                setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, unreadCount: 0 } : c)));
            }
        } finally {
            setLoadingMessages(false);
        }
    };

    const handleSend = async () => {
        if (!activeChat || !draft.trim() || sending) return;
        setSending(true);
        try {
            const ok = await sendStaffMessage({
                chatId: activeChat.id,
                body: draft.trim(),
                staffName: user?.name || undefined,
                staffUserId: user?.id,
            });
            if (ok) {
                setDraft("");
                const msgs = await getChatMessages(whatsappManager.getSessionIdSafe(), activeChat.id, 30);
                setMessages(msgs);
            }
        } finally {
            setSending(false);
        }
    };

    const handleBroadcastToPOS = async (msg: WPPMessage) => {
        const hints = extractVariantHints(msg.body || '');
        const query = hints.sku || hints.productKeywords[0] || '';
        if (!query) {
            toast.error('No product or SKU detected in this message');
            return;
        }
        try {
            const { getTypeAheadProducts } = await import('@/lib/products');
            const matches = await getTypeAheadProducts(query);
            let best = matches[0];
            if (hints.size) {
                best = matches.find((m) => (m.variant_name || '').includes(hints.size!)) || best;
            }
            if (!best) {
                toast.error(`No catalog match for "${query}"`);
                return;
            }
            broadcastAddToPOS({
                sku: best.full_sku,
                name: best.name,
                variant: best.variant_name,
                price: best.price,
                quantity: 1,
                productId: best.id,
                variantId: best.variant_id,
                sourceChatId: activeChat?.id,
                addedByName: activeChat?.name,
            });
            toast.success(`Sent 1x ${best.full_sku} to POS terminal cart`);
        } catch {
            toast.error('Failed to send to POS');
        }
    };

    const handleAutoBarcodeTag = async (msg: WPPMessage) => {
        const hints = extractVariantHints(msg.body || '');
        const query = hints.sku || hints.productKeywords[0] || '';
        if (!query) {
            toast.error('No SKU detected to tag');
            return;
        }
        try {
            const { getTypeAheadProducts } = await import('@/lib/products');
            const matches = await getTypeAheadProducts(query);
            if (!matches[0]) {
                toast.error(`No variant found for "${query}"`);
                return;
            }
            await queueLabelPrint({
                variantId: matches[0].variant_id,
                quantity: 1,
                template: 'dumbbell',
                source: 'vendor_ingestion',
            });
            toast.success(`Barcode tag queued for ${matches[0].full_sku} — print from /labels`);
        } catch {
            toast.error('Failed to queue tag');
        }
    };

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loadingMessages]);

    const filteredChats = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return chats;
        return chats.filter(
            (c) => c.name.toLowerCase().includes(q) || c.id.includes(q) || (c.lastMessage?.body || '').toLowerCase().includes(q)
        );
    }, [chats, search]);

    if (hidden) return null;

    const currentContactType = activeChat ? contactTypes[activeChat.id] || 'lead' : 'lead';

    return (
        <>
            {/* Floating button pinned bottom-right of every ERP screen */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-[90] size-12 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white shadow-[0_6px_20px_rgba(16,185,129,0.45)] flex items-center justify-center transition-transform hover:scale-105"
                    title="WhatsApp Chats"
                >
                    <MessageCircle size={22} />
                    {chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0) > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center border-2 border-background">
                            {chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0)}
                        </span>
                    )}
                </button>
            )}

            {/* Slide-over panel */}
            {isOpen && (
                <div className="fixed inset-0 z-[95] flex justify-end">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => { setIsOpen(false); setActiveChat(null); }} />
                    <div className="relative ml-auto h-full w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-emerald-500/10">
                            <div className="flex items-center gap-2">
                                <span className="size-8 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                                    <MessageCircle size={16} />
                                </span>
                                <div>
                                    <h3 className="text-sm font-bold text-foreground leading-tight">WhatsApp</h3>
                                    <p className="text-[10px] text-muted-foreground">Store Line · Conversational CRM</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={loadChats} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Refresh">
                                    <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                                </button>
                                <button onClick={() => { setIsOpen(false); setActiveChat(null); }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Close">
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        {!activeChat ? (
                            <>
                                {/* Search */}
                                <div className="p-2.5 border-b border-border">
                                    <div className="relative">
                                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <input
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            placeholder="Search chats…"
                                            className="w-full h-8 pl-8 pr-2 text-xs rounded-lg bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                    </div>
                                </div>

                                {/* Conversation list */}
                                <div className="flex-1 overflow-y-auto">
                                    {loading && chats.length === 0 && (
                                        <div className="flex items-center justify-center py-10 text-muted-foreground text-xs gap-2">
                                            <Loader2 size={14} className="animate-spin" /> Loading chats…
                                        </div>
                                    )}
                                    {!loading && filteredChats.length === 0 && (
                                        <div className="text-center text-xs text-muted-foreground py-10 px-4">
                                            No conversations found. Pair the store WhatsApp from the
                                            <span className="text-primary font-semibold"> WhatsApp hub</span>.
                                        </div>
                                    )}
                                    {filteredChats.map((chat) => (
                                        <button
                                            key={chat.id}
                                            onClick={() => openConversation(chat)}
                                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 border-b border-border/40 text-left transition-colors"
                                        >
                                            <span className="size-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                                                {chat.name.slice(0, 2).toUpperCase()}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-semibold text-foreground truncate">{chat.name}</span>
                                                    {contactTypes[chat.id] && (
                                                        <span className={cn(
                                                            'text-[9px] font-bold uppercase px-1 py-px rounded',
                                                            contactTypes[chat.id] === 'vendor' && 'bg-indigo-500/15 text-indigo-400',
                                                            contactTypes[chat.id] === 'customer' && 'bg-emerald-500/15 text-emerald-400',
                                                            contactTypes[chat.id] === 'lead' && 'bg-amber-500/15 text-amber-400',
                                                        )}>
                                                            {contactTypes[chat.id]}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[11px] text-muted-foreground truncate">{chat.lastMessage?.body || '—'}</p>
                                            </div>
                                            {chat.unreadCount > 0 && (
                                                <span className="min-w-5 h-5 px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                                                    {chat.unreadCount}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <>
                                {/* Conversation header */}
                                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                                    <button onClick={() => setActiveChat(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground text-xs">
                                        ←
                                    </button>
                                    <span className="size-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">
                                        {activeChat.name.slice(0, 2).toUpperCase()}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-bold truncate">{activeChat.name}</p>
                                        <p className="text-[10px] text-muted-foreground font-mono">{activeChat.id.split('@')[0]}</p>
                                    </div>
                                    <span className={cn(
                                        'text-[9px] font-bold uppercase px-2 py-0.5 rounded',
                                        currentContactType === 'vendor' && 'bg-indigo-500/15 text-indigo-400',
                                        currentContactType === 'customer' && 'bg-emerald-500/15 text-emerald-400',
                                        currentContactType === 'lead' && 'bg-amber-500/15 text-amber-400',
                                    )}>
                                        {currentContactType}
                                    </span>
                                </div>

                                {/* Transcript with Gesture Context Hook (spec §8.4) */}
                                <div
                                    {...longPressHandlers}
                                    className={cn('flex-1 overflow-y-auto p-3 space-y-2 bg-muted/20', longPressing && 'select-none')}
                                >
                                    {loadingMessages && (
                                        <div className="flex items-center justify-center py-8 text-muted-foreground text-xs gap-2">
                                            <Loader2 size={14} className="animate-spin" /> Loading…
                                        </div>
                                    )}
                                    {messages.map((m) => (
                                        <div
                                            key={m.id}
                                            data-msg-id={m.id}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                setActionMenu({
                                                    isOpen: true,
                                                    message: m,
                                                    position: { x: e.clientX, y: e.clientY },
                                                });
                                            }}
                                            className={cn('flex cursor-pointer', m.fromMe ? 'justify-end' : 'justify-start')}
                                        >
                                            <div className={cn(
                                                'max-w-[80%] px-3 py-1.5 rounded-xl text-xs whitespace-pre-wrap break-words transition-opacity hover:opacity-90',
                                                m.fromMe
                                                    ? 'bg-emerald-600 text-white rounded-br-sm'
                                                    : 'bg-card border border-border text-foreground rounded-bl-sm',
                                            )}>
                                                {m.body || (m.type !== 'chat' ? `[${m.type}]` : '')}
                                                <span className={cn('block text-[9px] mt-0.5', m.fromMe ? 'text-white/60' : 'text-muted-foreground')}>
                                                    {m.timestamp ? new Date(m.timestamp * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={messagesEndRef} />
                                </div>

                                {/* Composer */}
                                <div className="p-2.5 border-t border-border flex items-center gap-2">
                                    <input
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                                        placeholder="Type a message…"
                                        className="flex-1 h-9 px-3 text-xs rounded-full bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                    />
                                    <button
                                        onClick={handleSend}
                                        disabled={sending || !draft.trim()}
                                        className="size-9 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white flex items-center justify-center disabled:opacity-50"
                                    >
                                        {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Context Action Engine for Drawer (spec §8) */}
            <MessageActionMenu
                isOpen={actionMenu.isOpen}
                onClose={() => setActionMenu({ isOpen: false, message: null, position: null })}
                contactType={currentContactType}
                position={actionMenu.position}
                detectedAmount={(() => {
                    const m = actionMenu.message?.body?.match(/₹?\s*([\d,]{2,7})/);
                    return m ? parseInt(m[1].replace(/,/g, ''), 10) : undefined;
                })()}
                detectedSku={extractVariantHints(actionMenu.message?.body || '').sku}
                onAddToCart={() => actionMenu.message && handleBroadcastToPOS(actionMenu.message)}
                onAddExistingInventory={() => setAddInventoryMsg(actionMenu.message?.body || '')}
                onCreateProduct={() => setVendorIngestMsg(actionMenu.message?.body || '')}
                onAutoBarcodeTag={() => actionMenu.message && handleAutoBarcodeTag(actionMenu.message)}
                onQuoteReply={() => setDraft(`> ${actionMenu.message?.body || ''}\n\n`)}
            />

            {/* Ingestion Modals */}
            {vendorIngestMsg !== null && (
                <VendorIngestionModal
                    isOpen
                    onClose={() => setVendorIngestMsg(null)}
                    messageBody={vendorIngestMsg}
                />
            )}
            {addInventoryMsg !== null && (
                <AddExistingInventoryModal
                    isOpen
                    onClose={() => setAddInventoryMsg(null)}
                    messageBody={addInventoryMsg}
                />
            )}
        </>
    );
}
