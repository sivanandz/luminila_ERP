"use client";

import * as React from "react";
import { getBottomDockInset } from "@/lib/utils";

export interface DockAwarePopup {
  /** Space (px) to keep clear at the bottom of the viewport. */
  inset: number;
  /** Whether the popup is open; the inset is refreshed on every open. */
  open: boolean;
}

export const DockInsetContext = React.createContext<DockAwarePopup>({
  inset: 8,
  open: false,
});

export function useDockInset<E = unknown>(
  onOpenChange?: (open: boolean, eventDetails: E) => void
) {
  const [state, setState] = React.useState<DockAwarePopup>({ inset: 8, open: false });
  const handleOpenChange = React.useCallback(
    (open: boolean, eventDetails: E) => {
      setState((prev) => ({
        inset: open ? getBottomDockInset() : prev.inset,
        open,
      }));
      onOpenChange?.(open, eventDetails);
    },
    [onOpenChange]
  );
  return [state, handleOpenChange] as const;
}
