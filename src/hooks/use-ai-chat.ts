"use client";

/**
 * Streaming chat state for the /assistant page.
 *
 * The server is authoritative: live deltas render immediately for feedback,
 * then the finished turn is re-read from `GET /api/ai/conversations/[id]` so the
 * transcript always matches the persisted event log (including tool results and
 * pending approvals).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    AiClientError,
    deleteAiConversation,
    getAiConversation,
    getAiStatus,
    listAiConversations,
    streamAiChat,
} from '@/lib/ai-client';
import type {
    AiChatRequestBody,
    AiConversationMessage,
    AiConversationSummary,
    AiPendingApproval,
    AiStatusPayload,
    AiStreamEvent,
    AiTurnStatus,
} from '@/lib/ai/types';

export interface LiveToolCall {
    callId: string;
    name: string;
    arguments: string;
    status: 'running' | 'ok' | 'error' | 'denied';
    summary?: string;
    error?: string;
}

export interface LiveTurnMeta {
    provider: string;
    model: string;
    profile: string;
    turn: number;
}

export interface UseAiChatResult {
    status: AiStatusPayload | null;
    statusLoading: boolean;
    configured: boolean;
    conversations: AiConversationSummary[];
    conversationsLoading: boolean;
    activeConversationId: string | null;
    messages: AiConversationMessage[];
    liveTools: LiveToolCall[];
    streaming: boolean;
    streamText: string;
    streamReasoning: string;
    liveMeta: LiveTurnMeta | null;
    pendingApprovals: AiPendingApproval[];
    lastTurnStatus: AiTurnStatus | null;
    error: string | null;
    profileId: string;
    setProfileId: (id: string) => void;
    providerId: string;
    setProviderId: (id: string) => void;
    send: (text: string) => Promise<void>;
    decideApprovals: (approvedCallIds: string[]) => Promise<void>;
    stop: () => void;
    newConversation: () => void;
    openConversation: (id: string) => Promise<void>;
    removeConversation: (id: string) => Promise<void>;
    reloadStatus: () => Promise<void>;
    clearError: () => void;
}

const DEFAULT_PROFILE = 'analyst';

function errorMessage(error: unknown): string {
    if (error instanceof AiClientError) return error.message;
    if (error instanceof Error) {
        if (error.name === 'AbortError') return 'Stopped.';
        return error.message;
    }
    return 'The AI request failed.';
}

export function useAiChat(): UseAiChatResult {
    const [status, setStatus] = useState<AiStatusPayload | null>(null);
    const [statusLoading, setStatusLoading] = useState(true);
    const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
    const [conversationsLoading, setConversationsLoading] = useState(true);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<AiConversationMessage[]>([]);
    const [liveTools, setLiveTools] = useState<LiveToolCall[]>([]);
    const [streaming, setStreaming] = useState(false);
    const [streamText, setStreamText] = useState('');
    const [streamReasoning, setStreamReasoning] = useState('');
    const [liveMeta, setLiveMeta] = useState<LiveTurnMeta | null>(null);
    const [pendingApprovals, setPendingApprovals] = useState<AiPendingApproval[]>([]);
    const [lastTurnStatus, setLastTurnStatus] = useState<AiTurnStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [profileId, setProfileIdState] = useState<string>(DEFAULT_PROFILE);
    const [providerId, setProviderIdState] = useState<string>('');

    const abortRef = useRef<AbortController | null>(null);
    const activeIdRef = useRef<string | null>(null);
    const metaReceivedRef = useRef(false);
    const mountedRef = useRef(true);

    const configured = Boolean(status?.configured);

    const reloadStatus = useCallback(async () => {
        setStatusLoading(true);
        try {
            const payload = await getAiStatus();
            if (!mountedRef.current) return;
            setStatus(payload);
            setProfileIdState((current) =>
                payload.profiles.some((profile) => profile.id === current) ? current : payload.profiles[0]?.id ?? DEFAULT_PROFILE
            );
            setProviderIdState((current) => {
                if (current) return current;
                const preferred = payload.providers.find((provider) => provider.isDefault) ?? payload.providers[0];
                return preferred?.id ?? '';
            });
        } catch (loadError) {
            if (mountedRef.current) setError(errorMessage(loadError));
        } finally {
            if (mountedRef.current) setStatusLoading(false);
        }
    }, []);

    const reloadConversations = useCallback(async () => {
        setConversationsLoading(true);
        try {
            const list = await listAiConversations();
            if (mountedRef.current) setConversations(list);
        } catch (loadError) {
            if (mountedRef.current) setError(errorMessage(loadError));
        } finally {
            if (mountedRef.current) setConversationsLoading(false);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void reloadStatus();
        void reloadConversations();
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
        };
    }, [reloadStatus, reloadConversations]);

    const loadDetail = useCallback(async (id: string) => {
        const detail = await getAiConversation(id);
        if (!mountedRef.current) return;
        setMessages(detail.messages);
        setPendingApprovals(detail.pendingApprovals);
        setLastTurnStatus(detail.conversation.status === 'idle' ? null : detail.conversation.status);
    }, []);

    const openConversation = useCallback(
        async (id: string) => {
            abortRef.current?.abort();
            activeIdRef.current = id;
            setActiveConversationId(id);
            setError(null);
            setLiveTools([]);
            setStreamText('');
            setStreamReasoning('');
            try {
                const detail = await getAiConversation(id);
                if (!mountedRef.current) return;
                setMessages(detail.messages);
                setPendingApprovals(detail.pendingApprovals);
                setLastTurnStatus(detail.conversation.status === 'idle' ? null : detail.conversation.status);
                setProfileIdState((current) => detail.conversation.profileId || current);
                setProviderIdState((current) => current || detail.conversation.providerId || '');
            } catch (loadError) {
                if (mountedRef.current) setError(errorMessage(loadError));
            }
        },
        []
    );

    const newConversation = useCallback(() => {
        abortRef.current?.abort();
        activeIdRef.current = null;
        setActiveConversationId(null);
        setMessages([]);
        setLiveTools([]);
        setStreamText('');
        setStreamReasoning('');
        setLiveMeta(null);
        setPendingApprovals([]);
        setLastTurnStatus(null);
        setError(null);
    }, []);

    const removeConversation = useCallback(
        async (id: string) => {
            try {
                await deleteAiConversation(id);
                if (activeIdRef.current === id) newConversation();
                await reloadConversations();
            } catch (deleteError) {
                if (mountedRef.current) setError(errorMessage(deleteError));
            }
        },
        [newConversation, reloadConversations]
    );

    const handleEvent = useCallback((event: AiStreamEvent) => {
        if (!mountedRef.current) return;
        switch (event.event) {
            case 'meta': {
                metaReceivedRef.current = true;
                activeIdRef.current = event.data.conversationId;
                setActiveConversationId(event.data.conversationId);
                setLiveMeta({
                    provider: event.data.provider,
                    model: event.data.model,
                    profile: event.data.profile,
                    turn: event.data.turn,
                });
                break;
            }
            case 'text':
                setStreamText((current) => current + event.data.delta);
                break;
            case 'reasoning':
                setStreamReasoning((current) => current + event.data.delta);
                break;
            case 'tool_call':
                setLiveTools((current) => [
                    ...current,
                    {
                        callId: event.data.callId,
                        name: event.data.name,
                        arguments: event.data.arguments,
                        status: 'running',
                    },
                ]);
                break;
            case 'tool_result':
                setLiveTools((current) =>
                    current.map((tool) =>
                        tool.callId === event.data.callId
                            ? {
                                ...tool,
                                status: event.data.status,
                                summary: event.data.summary,
                                error: event.data.error,
                            }
                            : tool
                    )
                );
                break;
            case 'approval_request':
                setPendingApprovals((current) =>
                    current.some((approval) => approval.callId === event.data.callId)
                        ? current
                        : [...current, event.data]
                );
                break;
            case 'error':
                setError(event.data.message);
                break;
            case 'done':
                setLastTurnStatus(event.data.status);
                break;
            default:
                break;
        }
    }, []);

    const runTurn = useCallback(
        async (request: AiChatRequestBody) => {
            if (abortRef.current) abortRef.current.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setStreaming(true);
            setError(null);
            setStreamText('');
            setStreamReasoning('');
            setLiveTools([]);
            setLiveMeta(null);
            metaReceivedRef.current = false;

            const requestWithSelection: AiChatRequestBody = {
                ...request,
                profileId: request.profileId ?? profileId,
                providerId: request.providerId ?? (providerId || undefined),
            };

            try {
                await streamAiChat(requestWithSelection, { signal: controller.signal, onEvent: handleEvent });
            } catch (streamError) {
                if (controller.signal.aborted) {
                    // Operator pressed Stop: keep whatever streamed.
                } else {
                    if (mountedRef.current) {
                        setError(errorMessage(streamError));
                        if (!metaReceivedRef.current) {
                            // The turn never reached the server (503/409/network):
                            // remove the optimistic bubble that was never persisted.
                            setMessages((current) => current.filter((message) => !message.id.startsWith('local_user_')));
                        }
                    }
                }
            } finally {
                if (mountedRef.current) {
                    setStreaming(false);
                    setStreamText('');
                    setStreamReasoning('');
                    setLiveTools([]);
                    const conversationId = activeIdRef.current;
                    if (conversationId) {
                        try {
                            await loadDetail(conversationId);
                        } catch {
                            // The transcript refresh is best-effort; the error banner
                            // already reflects any streaming failure.
                        }
                    }
                    await reloadConversations();
                }
                if (abortRef.current === controller) abortRef.current = null;
            }
        },
        [handleEvent, loadDetail, profileId, providerId, reloadConversations]
    );

    const send = useCallback(
        async (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || streaming) return;
            const userMessage: AiConversationMessage = {
                id: `local_user_${Date.now()}`,
                role: 'user',
                turn: 0,
                text: trimmed,
                createdAt: new Date().toISOString(),
            };
            setMessages((current) => [...current, userMessage]);
            await runTurn({ message: trimmed, conversationId: activeIdRef.current ?? undefined });
        },
        [runTurn, streaming]
    );

    const decideApprovals = useCallback(
        async (approvedCallIds: string[]) => {
            if (streaming) return;
            const conversationId = activeIdRef.current;
            if (!conversationId) return;
            setPendingApprovals([]);
            await runTurn({ conversationId, approvals: approvedCallIds });
        },
        [runTurn, streaming]
    );

    const stop = useCallback(() => {
        abortRef.current?.abort();
        setStreaming(false);
    }, []);

    return {
        status,
        statusLoading,
        configured,
        conversations,
        conversationsLoading,
        activeConversationId,
        messages,
        liveTools,
        streaming,
        streamText,
        streamReasoning,
        liveMeta,
        pendingApprovals,
        lastTurnStatus,
        error,
        profileId,
        setProfileId: setProfileIdState,
        providerId,
        setProviderId: setProviderIdState,
        send,
        decideApprovals,
        stop,
        newConversation,
        openConversation,
        removeConversation,
        reloadStatus,
        clearError: () => setError(null),
    };
}
