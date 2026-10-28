"use client";

import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";

/**
 * Persistent motion pause control (Niththigal example parity). Toggles
 * `data-motion="paused"` on the page root; CSS pauses all animations and
 * collapses transitions. Honours the visitor's reduced-motion preference.
 */
export function MotionToggle() {
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        try {
            setPaused(localStorage.getItem("niththigal_motion_paused") === "1");
        } catch { /* storage unavailable */ }
    }, []);

    useEffect(() => {
        document.querySelectorAll<HTMLElement>(".nt-root").forEach((el) => {
            if (paused) el.setAttribute("data-motion", "paused");
            else el.removeAttribute("data-motion");
        });
        try {
            localStorage.setItem("niththigal_motion_paused", paused ? "1" : "0");
        } catch { /* ignore */ }
    }, [paused]);

    return (
        <button
            className="nt-motion-toggle"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Resume animations" : "Pause animations"}
            aria-pressed={paused}
            title={paused ? "Resume animations" : "Pause animations"}
        >
            {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
    );
}
