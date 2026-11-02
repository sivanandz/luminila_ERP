"use client";

/**
 * Global analytics range state (Analytics Deep-Insights).
 * One zustand store so every tab shares the selected window.
 */

import { create } from 'zustand';
import type { AnalyticsRange, RangePreset } from './range';

interface AnalyticsRangeState {
    range: AnalyticsRange;
    setPreset: (preset: RangePreset) => void;
    setCustom: (start: string, end: string) => void;
}

export const useAnalyticsRange = create<AnalyticsRangeState>((set) => ({
    range: { preset: '30d' },
    setPreset: (preset) => set({ range: { preset } }),
    setCustom: (start, end) => set({ range: { preset: 'custom', start, end } }),
}));
