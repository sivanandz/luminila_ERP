"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout";
import {
    whatsappManager,
    checkWPPConnectStatus,
    parseOrderFromMessage,
    generateAutoReply,
} from "@/lib/whatsapp";
import type { WPPMessage } from "@/lib/whatsapp";
import {
    MessageCircle,
    Wifi,
    WifiOff,
    Send,
    User,
    Clock,
    Package,
    AlertCircle,
    Phone,
    Video,
    MoreVertical,
    CheckCheck
} from "lucide-react";

interface Message {
    id: string;
    from: string;
    fromName: string;
    body: string;
    timestamp: Date;
    isOrder: boolean;
    parsed?: ReturnType<typeof parseOrderFromMessage>;
}

export default function WhatsAppPage() {
    const [serverStatus, setServerStatus] = useState<"checking" | "online" | "offline">("checking");
    const [sessionStatus, setSessionStatus] = useState<"disconnected" | "connecting" | "qr" | "connected">("disconnected");
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [selectedChat, setSelectedChat] = useState<string | null>(null);
    const [replyText, setReplyText] = useState("");
    const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);

    // Check WPPConnect server status
    useEffect(() => {
        const checkServer = async () => {
            const isOnline = await checkWPPConnectStatus();
            setServerStatus(isOnline ? "online" : "offline");

            if (isOnline) {
                const status = await whatsappManager.getStatus();
                if (status === "CONNECTED") {
                    setSessionStatus("connected");
                }
            }
        };

        checkServer();
        const interval = setInterval(checkServer, 30000);
        return () => clearInterval(interval);
    }, []);

    // Handle connection
    const handleConnect = async () => {
        setSessionStatus("connecting");
        const started = await whatsappManager.connect();

        if (started) {
            // Start polling for status/QR
            const pollInterval = setInterval(async () => {
                const status = await whatsappManager.getStatus();

                if (status === "CONNECTED") {
                    setSessionStatus("connected");
                    setQrCode(null);
                    clearInterval(pollInterval);
                    startMessagePolling();
                } else if (status === "QR_CODE") {
                    setSessionStatus("qr");
                    const qr = await whatsappManager.getQR();
                    if (qr) setQrCode(qr);
                } else if (status === "INITIALIZING") {
                    setSessionStatus("connecting");
                }
            }, 2000);

            // Cleanup interval on unmount or disconnect (handled by effect cleanup if we stored ref, 
            // but here we trust state transition will stop it eventually or manual disconnect)
        } else {
            setSessionStatus("disconnected");
            alert("Failed to start WhatsApp session. Is the sidecar running?");
        }
    };

    // Handle disconnect
    const handleDisconnect = async () => {
        await whatsappManager.disconnect();
        setSessionStatus("disconnected");
        setMessages([]);
    };

    // Start polling for messages
    const startMessagePolling = useCallback(() => {
        whatsappManager.startPolling((newMessages) => {
            const parsed = newMessages.map((msg: WPPMessage) => ({
                id: msg.id,
                from: msg.from,
                fromName: msg.sender?.pushname || msg.sender?.name || "Unknown",
                body: msg.body,
                timestamp: new Date(msg.timestamp * 1000),
                isOrder: parseOrderFromMessage(msg.body).isOrder,
                parsed: parseOrderFromMessage(msg.body),
            }));

            setMessages((prev) => [...parsed, ...prev]);

            // Auto-reply
            if (autoReplyEnabled) {
                parsed.forEach(async (msg) => {
                    const reply = generateAutoReply(msg.body, []);
                    if (reply) {
                        await whatsappManager.sendMessage(msg.from, reply);
                    }
                });
            }
        });
    }, [autoReplyEnabled]);

    // Send reply
    const sendReply = async () => {
        if (!selectedChat || !replyText.trim()) return;

        const success = await whatsappManager.sendMessage(selectedChat, replyText);
        if (success) {
            setReplyText("");
        }
    };

    // Group messages by sender
    const chatList = messages.reduce((acc, msg) => {
        if (!acc[msg.from]) {
            acc[msg.from] = {
                from: msg.from,
                name: msg.fromName,
                lastMessage: msg.body,
                lastTime: msg.timestamp,
                hasOrder: msg.isOrder,
                unread: 0,
            };
        }
        acc[msg.from].unread++;
        return acc;
    }, {} as Record<string, { from: string; name: string; lastMessage: string; lastTime: Date; hasOrder: boolean; unread: number }>);

    const selectedMessages = messages.filter((m) => m.from === selectedChat);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="WhatsApp Integration" subtitle="Manage customer orders via WhatsApp" />

            <div className="flex-1 overflow-hidden p-6">

                {/* Server Status Banner */}
                {serverStatus === "offline" && (
                    <div className="mb-6 p-4 bg-red-400/10 border border-red-400/30 rounded-xl flex items-center gap-3">
                        <AlertCircle className="text-red-400" size={20} />
                        <div>
                            <p className="font-bold text-red-400">WPPConnect Server Not Running</p>
                            <p className="text-sm text-moonstone">
                                Start the WPPConnect sidecar to enable WhatsApp features.
                            </p>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full pb-2">
                    {/* Left Panel - Connection & Chats (3 cols) */}
                    <div className="lg:col-span-3 bg-surface-navy rounded-xl border border-surface-hover flex flex-col overflow-hidden">
                        {/* Connection Status */}
                        <div className={`p-4 border-b border-surface-hover ${sessionStatus === "connected" ? "bg-green-500/10" : "bg-bg-navy/50"
                            }`}>
                            <div className="flex items-center gap-3">
                                {sessionStatus === "connected" ? (
                                    <Wifi size={20} className="text-green-400" />
                                ) : (
                                    <WifiOff size={20} className="text-moonstone" />
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className={`font-bold text-sm ${sessionStatus === "connected" ? "text-green-400" : "text-white"}`}>
                                        {sessionStatus === "connected" ? "Connected" :
                                            sessionStatus === "qr" ? "Scan QR Code" :
                                                sessionStatus === "connecting" ? "Connecting..." : "Disconnected"}
                                    </p>
                                    <p className="text-xs text-moonstone truncate">
                                        {sessionStatus === "connected" ? "Session Active" :
                                            "Connect to chat"}
                                    </p>
                                </div>
                                {sessionStatus === "connected" ? (
                                    <button onClick={handleDisconnect} className="text-xs bg-bg-navy hover:bg-white/10 text-white px-3 py-1.5 rounded-lg font-bold border border-surface-hover transition-colors">
                                        Disconnect
                                    </button>
                                ) : serverStatus === "online" && sessionStatus === "disconnected" ? (
                                    <button onClick={handleConnect} className="text-xs bg-primary hover:bg-primary/90 text-bg-navy px-3 py-1.5 rounded-lg font-bold transition-colors">
                                        Connect
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        {/* QR Code Overlay */}
                        {sessionStatus === "qr" && qrCode && (
                            <div className="p-4 flex flex-col items-center justify-center flex-1 bg-bg-navy/50">
                                <div className="bg-white p-2 rounded-lg mb-3 shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={qrCode} alt="WhatsApp QR Code" className="w-40 h-40" />
                                </div>
                                <p className="text-xs text-moonstone text-center">
                                    Open WhatsApp Mobile <br /> Menu &gt; Linked Devices &gt; Link a Device
                                </p>
                            </div>
                        )}

                        {/* Chat List */}
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            <div className="px-2 py-2 text-xs font-bold text-moonstone uppercase tracking-wider">Conversations</div>
                            {Object.values(chatList).length === 0 ? (
                                <div className="text-center py-10 opacity-50">
                                    <MessageCircle size={32} className="mx-auto text-moonstone mb-2" />
                                    <p className="text-xs text-moonstone">No messages</p>
                                </div>
                            ) : (
                                Object.values(chatList).map((chat) => (
                                    <button
                                        key={chat.from}
                                        onClick={() => setSelectedChat(chat.from)}
                                        className={`w-full p-3 rounded-lg text-left transition-all ${selectedChat === chat.from
                                                ? "bg-primary text-bg-navy shadow-[0_0_15px_rgba(196,166,97,0.3)]"
                                                : "hover:bg-bg-navy/50 text-moonstone hover:text-white"
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${selectedChat === chat.from ? "bg-bg-navy/20 text-bg-navy" : "bg-bg-navy text-primary border border-surface-hover"
                                                }`}>
                                                <User size={18} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-0.5">
                                                    <p className={`font-bold text-sm truncate ${selectedChat === chat.from ? "text-bg-navy" : "text-white"}`}>
                                                        {chat.name}
                                                    </p>
                                                    {chat.timestamp && (
                                                        <span className={`text-[10px] ${selectedChat === chat.from ? "text-bg-navy/70" : "text-moonstone"}`}>
                                                            {new Date(chat.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <p className={`text-xs truncate max-w-[120px] ${selectedChat === chat.from ? "text-bg-navy/80" : "text-moonstone"}`}>
                                                        {chat.lastMessage}
                                                    </p>
                                                    {chat.unread > 0 && (
                                                        <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                                                            {chat.unread}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>

                        {/* Auto-Reply Footer */}
                        <div className="p-4 border-t border-surface-hover bg-bg-navy/30">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="font-bold text-xs text-white">Auto-Reply</p>
                                    <p className="text-[10px] text-moonstone">Send automated responses</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={autoReplyEnabled}
                                        onChange={(e) => setAutoReplyEnabled(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-9 h-5 bg-surface-hover peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Middle Panel - Messages (6 cols) */}
                    <div className="lg:col-span-6 bg-surface-navy rounded-xl border border-surface-hover flex flex-col overflow-hidden relative">
                        {selectedChat ? (
                            <>
                                {/* Chat Header */}
                                <div className="h-16 px-6 border-b border-surface-hover flex items-center justify-between bg-surface-navy/50 backdrop-blur-sm absolute top-0 left-0 right-0 z-10">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-bg-navy border border-surface-hover flex items-center justify-center text-primary">
                                            <User size={20} />
                                        </div>
                                        <div>
                                            <p className="font-bold text-white text-sm">{chatList[selectedChat]?.name}</p>
                                            <p className="text-xs text-moonstone">{selectedChat}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button className="p-2 text-moonstone hover:text-white hover:bg-bg-navy rounded-lg transition-colors">
                                            <Phone size={18} />
                                        </button>
                                        <button className="p-2 text-moonstone hover:text-white hover:bg-bg-navy rounded-lg transition-colors">
                                            <Video size={18} />
                                        </button>
                                        <button className="p-2 text-moonstone hover:text-white hover:bg-bg-navy rounded-lg transition-colors">
                                            <MoreVertical size={18} />
                                        </button>
                                    </div>
                                </div>

                                {/* Messages Area */}
                                <div className="flex-1 overflow-y-auto p-6 pt-20 space-y-4 bg-bg-navy/30">
                                    {selectedMessages.reverse().map((msg) => (
                                        <div key={msg.id} className={`flex ${msg.from.includes("") ? "justify-start" : "justify-end"}`}>
                                            {/* Note: In real app, check if msg.fromMe */}
                                            {/* For now assuming all incoming are left, outgoing right logic needed if we store 'fromMe' */}
                                            <div className="max-w-[80%]">
                                                <div className="bg-surface-navy border border-surface-hover p-4 rounded-2xl rounded-tl-none shadow-sm">
                                                    <p className="text-sm text-white leading-relaxed">{msg.body}</p>
                                                </div>
                                                <div className="flex items-center gap-1 mt-1 ml-1 text-[10px] text-moonstone">
                                                    <span>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                    {msg.isOrder && (
                                                        <span className="text-primary font-bold flex items-center gap-1 ml-2">
                                                            <Package size={10} /> Order Inquiry
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Reply Input */}
                                <div className="p-4 border-t border-surface-hover bg-surface-navy">
                                    <div className="flex items-center gap-3 bg-bg-navy rounded-xl border border-surface-hover p-2 pr-2">
                                        <button className="p-2 text-moonstone hover:text-white transition-colors">
                                            <Package size={20} />
                                        </button>
                                        <input
                                            type="text"
                                            value={replyText}
                                            onChange={(e) => setReplyText(e.target.value)}
                                            placeholder="Type a message..."
                                            className="flex-1 bg-transparent border-none text-white text-sm placeholder-moonstone focus:ring-0"
                                            onKeyDown={(e) => e.key === "Enter" && sendReply()}
                                        />
                                        <button
                                            onClick={sendReply}
                                            className="bg-primary hover:bg-primary/90 text-bg-navy p-2 rounded-lg transition-colors"
                                        >
                                            <Send size={18} />
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 opacity-50">
                                <div className="w-20 h-20 bg-bg-navy rounded-full flex items-center justify-center mb-4 border border-surface-hover">
                                    <MessageCircle size={40} className="text-primary" />
                                </div>
                                <h3 className="text-white text-lg font-bold">WhatsApp Web</h3>
                                <p className="text-moonstone text-sm max-w-xs mt-2">
                                    Select a conversation from the left to start chatting or manage orders.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Right Panel - Order Details (3 cols) */}
                    <div className="lg:col-span-3 bg-surface-navy rounded-xl border border-surface-hover flex flex-col overflow-hidden p-6">
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-6">Order Context</h2>

                        {selectedChat && chatList[selectedChat]?.hasOrder ? (
                            <div className="space-y-6">
                                <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Package size={18} className="text-green-400" />
                                        <p className="font-bold text-green-400 text-sm">Potential Order</p>
                                    </div>
                                    <p className="text-xs text-moonstone">
                                        AI has detected order intent in this conversation.
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    <button className="w-full bg-primary hover:bg-primary/90 text-bg-navy h-10 rounded-lg text-sm font-bold transition-colors">
                                        Create Order
                                    </button>
                                    <button className="w-full bg-bg-navy hover:bg-surface-hover text-white h-10 rounded-lg text-sm font-bold border border-surface-hover transition-colors">
                                        Send Catalog
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-10 opacity-50">
                                <Package size={32} className="mx-auto text-moonstone mb-3" />
                                <p className="text-moonstone text-xs">
                                    No order details context available for this chat.
                                </p>
                            </div>
                        )}

                        {/* Templates */}
                        <div className="mt-auto pt-6 border-t border-surface-hover">
                            <h3 className="text-xs font-bold text-moonstone uppercase tracking-wider mb-3">Quick Replies</h3>
                            <div className="space-y-2">
                                {[
                                    "Thank you for your interest! 🙏",
                                    "Your order has been confirmed ✅",
                                    "Please share your delivery address 📍",
                                    "We'll update you when it ships 📦",
                                ].map((template, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setReplyText(template)}
                                        className="w-full p-3 text-left text-xs text-white bg-bg-navy hover:bg-surface-hover rounded-lg border border-surface-hover transition-colors"
                                    >
                                        {template}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
