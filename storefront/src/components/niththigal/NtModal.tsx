"use client";

import { useEffect, useRef } from "react";

function syncBodyLock() {
    if (typeof document === "undefined") return;
    const anyOpen = Boolean(document.querySelector("dialog[open]"));
    document.body.classList.toggle("modal-open", anyOpen);
}

/**
 * Native <dialog> wrapper: top-layer modal, Escape/backdrop close, body lock
 * and the browser's own focus restoration.
 */
export function NtModal({
    open,
    onClose,
    className,
    labelledBy,
    children,
}: {
    open: boolean;
    onClose: () => void;
    className: string;
    labelledBy: string;
    children: React.ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            dialog.showModal();
            document.body.classList.add("modal-open");
        } else if (!open && dialog.open) {
            dialog.close();
            syncBodyLock();
        }
        return () => {
            if (dialog.open) dialog.close();
        };
    }, [open]);

    useEffect(() => {
        return () => {
            document.body.classList.remove("modal-open");
        };
    }, []);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog || !open) return;
        const onCancel = (event: Event) => {
            event.preventDefault();
            onClose();
        };
        dialog.addEventListener("cancel", onCancel);
        return () => dialog.removeEventListener("cancel", onCancel);
    }, [open, onClose]);

    const onClick = (event: React.MouseEvent<HTMLDialogElement>) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const outside =
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom;
        if (outside) onClose();
    };

    return (
        <dialog
            ref={ref}
            className={className}
            aria-labelledby={labelledBy}
            onClick={onClick}
        >
            {children}
        </dialog>
    );
}
