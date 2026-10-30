"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, X, Crown, Shield, UserMinus, UserPlus, Copy, Check, DoorOpen } from "lucide-react";
import {
    getGroupMembers,
    getGroupInviteLink,
    setGroupMemberRole,
    setGroupSubject,
    setGroupDescription,
    setGroupAdminsOnly,
    addGroupParticipant,
    removeGroupParticipant,
    leaveGroup,
    type WPPGroupMember,
} from "@/lib/whatsapp";
import { toast } from "sonner";

export interface GroupInfoModalProps {
    isOpen: boolean;
    onClose: () => void;
    sessionId: string;
    groupId: string;
    /** Current chat name, used as the initial subject value. */
    initialName?: string;
    /** Called after membership or metadata changed so the chat list can refresh. */
    onChanged?: () => void;
    /** Called after leaving the group; the parent should clear the selection. */
    onLeft?: () => void;
}

/**
 * Group management panel: members with admin roles, promote/demote, add/remove,
 * subject/description, admins-only toggle, invite link and leave.
 */
export function GroupInfoModal({
    isOpen,
    onClose,
    sessionId,
    groupId,
    initialName,
    onChanged,
    onLeft,
}: GroupInfoModalProps) {
    const [members, setMembers] = useState<WPPGroupMember[]>([]);
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [subject, setSubject] = useState(initialName || '');
    const [description, setDescription] = useState('');
    const [adminsOnly, setAdminsOnly] = useState<boolean | null>(null);
    const [inviteLink, setInviteLink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [adding, setAdding] = useState(false);
    const [newPhone, setNewPhone] = useState('');

    const reload = useCallback(async () => {
        if (!groupId) return;
        setLoading(true);
        try {
            const list = await getGroupMembers(sessionId, groupId);
            setMembers(list);
        } finally {
            setLoading(false);
        }
    }, [sessionId, groupId]);

    useEffect(() => {
        if (!isOpen) return;
        setSubject(initialName || '');
        setInviteLink(null);
        setAdminsOnly(null);
        void reload();
    }, [isOpen, initialName, reload]);

    if (!isOpen) return null;

    const runForMember = async (id: string, label: string, action: () => Promise<boolean>) => {
        setBusyId(id);
        try {
            const ok = await action();
            toast[ok ? 'success' : 'error'](ok ? label : `${label} failed`);
            if (ok) await reload();
            onChanged?.();
        } finally {
            setBusyId(null);
        }
    };

    const handleCopyLink = async () => {
        let link = inviteLink;
        if (!link) {
            link = await getGroupInviteLink(sessionId, groupId);
            if (!link) {
                toast.error('Could not fetch the invite link (are you a group admin?)');
                return;
            }
            setInviteLink(link);
        }
        await navigator.clipboard?.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    };

    const handleLeave = async () => {
        if (!window.confirm('Leave this group? You will need a new invite to rejoin.')) return;
        const ok = await leaveGroup(sessionId, groupId);
        if (ok) {
            toast.success('Left the group');
            onLeft?.();
            onClose();
            onChanged?.();
        } else {
            toast.error('Could not leave the group');
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
            <div className="relative w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl flex flex-col max-h-[80vh]">
                {/* Header */}
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <h3 className="text-sm font-bold text-foreground">Group info</h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Subject + description */}
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-muted-foreground">Name</label>
                        <div className="flex gap-2">
                            <input
                                value={subject}
                                onChange={e => setSubject(e.target.value)}
                                className="flex-1 bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <button
                                onClick={async () => {
                                    const ok = await setGroupSubject(sessionId, groupId, subject);
                                    toast[ok ? 'success' : 'error'](ok ? 'Group renamed' : 'Rename failed');
                                    onChanged?.();
                                }}
                                className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold"
                            >
                                Save
                            </button>
                        </div>
                        <label className="text-xs font-semibold text-muted-foreground block pt-1">Description</label>
                        <div className="flex gap-2">
                            <input
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Group description…"
                                className="flex-1 bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <button
                                onClick={async () => {
                                    const ok = await setGroupDescription(sessionId, groupId, description);
                                    toast[ok ? 'success' : 'error'](ok ? 'Description updated' : 'Update failed');
                                }}
                                className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold"
                            >
                                Save
                            </button>
                        </div>
                    </div>

                    {/* Admins-only toggle + invite link */}
                    <div className="flex items-center justify-between gap-3 pt-1">
                        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={adminsOnly === true}
                                onChange={async e => {
                                    const value = e.target.checked;
                                    setAdminsOnly(value);
                                    const ok = await setGroupAdminsOnly(sessionId, groupId, value);
                                    toast[ok ? 'success' : 'error'](ok
                                        ? (value ? 'Only admins can send now' : 'Everyone can send again')
                                        : 'Toggle failed');
                                    if (!ok) setAdminsOnly(!value);
                                }}
                                className="accent-primary"
                            />
                            Only admins can send messages
                        </label>
                        <button
                            onClick={handleCopyLink}
                            className="text-xs font-semibold text-sky-500 hover:underline flex items-center gap-1 shrink-0"
                        >
                            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                            {copied ? 'Copied!' : 'Copy invite link'}
                        </button>
                    </div>

                    {/* Members */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-muted-foreground">
                                Members {members.length > 0 ? `(${members.length})` : ''}
                            </p>
                            <button
                                onClick={() => setAdding(prev => !prev)}
                                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                            >
                                <UserPlus size={13} /> Add member
                            </button>
                        </div>

                        {adding && (
                            <div className="flex gap-2 mb-3">
                                <input
                                    value={newPhone}
                                    onChange={e => setNewPhone(e.target.value)}
                                    placeholder="Phone number, e.g. 919876543210"
                                    className="flex-1 bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <button
                                    onClick={async () => {
                                        if (!newPhone.trim()) return;
                                        const ok = await addGroupParticipant(sessionId, groupId, newPhone.replace(/\D/g, ''));
                                        toast[ok ? 'success' : 'error'](ok ? 'Member added' : 'Add failed');
                                        if (ok) {
                                            setNewPhone('');
                                            setAdding(false);
                                            await reload();
                                            onChanged?.();
                                        }
                                    }}
                                    className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold"
                                >
                                    Add
                                </button>
                            </div>
                        )}

                        {loading ? (
                            <div className="flex items-center justify-center py-6 text-muted-foreground">
                                <Loader2 size={18} className="animate-spin" />
                            </div>
                        ) : members.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-4 text-center">No members loaded</p>
                        ) : (
                            <ul className="space-y-1">
                                {members.map(m => (
                                    <li key={m.id} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-muted/60">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{m.name || m.id}</p>
                                            <p className="text-[10px] text-muted-foreground">
                                                {m.isSuperAdmin ? 'Creator' : m.isAdmin ? 'Admin' : 'Member'}
                                            </p>
                                        </div>
                                        {busyId === m.id ? (
                                            <Loader2 size={14} className="animate-spin text-muted-foreground" />
                                        ) : (
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    onClick={() => runForMember(m.id, m.isAdmin ? 'Demoted to member' : 'Promoted to admin',
                                                        () => setGroupMemberRole(sessionId, groupId, m.id, !m.isAdmin))}
                                                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                                                    title={m.isAdmin ? 'Demote to member' : 'Promote to admin'}
                                                >
                                                    {m.isAdmin ? <Shield size={14} /> : <Crown size={14} />}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (!window.confirm(`Remove ${m.name || m.id} from the group?`)) return;
                                                        void runForMember(m.id, 'Member removed', () => removeGroupParticipant(sessionId, groupId, m.id));
                                                    }}
                                                    className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
                                                    title="Remove from group"
                                                >
                                                    <UserMinus size={14} />
                                                </button>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-border">
                    <button
                        onClick={handleLeave}
                        className="w-full text-xs font-semibold text-red-500 hover:bg-red-500/10 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                    >
                        <DoorOpen size={14} /> Leave group
                    </button>
                </div>
            </div>
        </div>
    );
}
