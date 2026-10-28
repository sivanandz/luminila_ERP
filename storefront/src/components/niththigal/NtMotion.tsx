"use client";

import { useEffect } from "react";

type ScrollLayer = {
    region: Element;
    target: HTMLElement;
    property: string;
    rate: number;
    limit: number;
    current: number;
    desktopOnly?: boolean;
};

/**
 * Port of the example's motion.js: re-entrant staggered reveals, bounded
 * multi-layer parallax, pointer-following jewellery highlights, and the
 * persistent pause control. Runs once on the client and cleans up on unmount.
 */
export function NtMotion() {
    useEffect(() => {
        const root = document.documentElement;
        const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
        const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
        let paused = false;
        try {
            paused = localStorage.getItem("niththigal-motion") === "off";
        } catch {
            /* storage unavailable */
        }

        const button = document.createElement("button");
        button.className = "motion-toggle";
        button.type = "button";
        document.body.appendChild(button);

        // Turn structural containers into cascading child reveals, exactly as
        // the example does after load.
        const unwrapContainers = [
            ".collection .section-heading",
            ".story-copy",
            ".why .center-heading",
            ".love .section-heading",
            ".faq-intro",
            ".faq-list",
            ".instagram-head",
            ".price-story-copy",
            ".price-board",
        ];
        unwrapContainers.forEach((selector) => {
            const box = document.querySelector(selector);
            if (!box) return;
            box.classList.remove("reveal");
            [...box.children].forEach((child) => child.classList.add("reveal"));
        });
        [
            ".hero-copy > .entrance",
            ".hero-visual .image-caption",
            ".hero-visual .image-tag",
            ".promise-strip",
            ".footer-top > *",
            ".footer-bottom",
        ].forEach((selector) => {
            document.querySelectorAll(selector).forEach((element) => element.classList.add("reveal"));
        });

        const makeLayer = (
            regionSelector: string,
            targetSelector: string,
            property: string,
            rate: number,
            limit: number
        ): ScrollLayer | null => {
            const region = document.querySelector(regionSelector);
            const target = document.querySelector<HTMLElement>(targetSelector);
            if (!region || !target) return null;
            return { region, target, property, rate, limit, current: 0 };
        };

        const staticLayers = [
            makeLayer(".hero-visual", ".hero-visual > img", "--parallax-y", 0.12, 30),
            makeLayer(".hero-visual", ".image-caption", "--caption-y", -0.04, 10),
            makeLayer(".story-image", ".story-image > img", "--parallax-y", 0.105, 36),
            makeLayer(".story-image", ".story-stamp", "--stamp-y", -0.055, 16),
            makeLayer(".final-cta", ".orbit-one", "--orbit-y", 0.075, 28),
            makeLayer(".final-cta", ".orbit-two", "--orbit-y", -0.075, 28),
        ].filter((layer): layer is ScrollLayer => layer !== null);

        let cardLayers: ScrollLayer[] = [];
        function rebuildCardLayers() {
            cardLayers = [];
            [
                ".product-grid > .product-card",
                ".benefit-grid > .benefit",
                ".testimonial-grid > .quote-card",
                ".instagram-grid > .insta-card",
            ].forEach((selector) => {
                const items = [...document.querySelectorAll<HTMLElement>(selector)];
                items.forEach((element, index) => {
                    const column = index % 3;
                    const rate = column === 0 ? -0.024 : column === 1 ? 0.008 : 0.028;
                    const parent = element.parentElement;
                    if (!parent) return;
                    cardLayers.push({
                        region: parent,
                        target: element,
                        property: "--drift-y",
                        rate,
                        limit: 9,
                        current: 0,
                        desktopOnly: true,
                    });
                });
            });
        }

        let lastScrollY = window.scrollY;
        let scrollingUp = false;
        let nextWaveAt = 0;
        let lastBatchAt = -1e9;
        let revealFrame = 0;
        const pendingReveals = new Set<Element>();
        const STAGGER_STEP = 72;

        const enabled = () => !paused && !preference.matches;

        function flushReveals() {
            revealFrame = 0;
            if (!enabled()) {
                pendingReveals.clear();
                return;
            }
            const items = [...pendingReveals];
            pendingReveals.clear();
            const height = window.innerHeight;
            const ordered = items
                .filter((element) => element.isConnected && !element.classList.contains("visible"))
                .map((element) => ({ element, rect: element.getBoundingClientRect() }))
                .filter(({ rect }) => rect.bottom > 0 && rect.top < height)
                .sort((a, b) => {
                    const dy = a.rect.top - b.rect.top;
                    if (Math.abs(dy) > 18) return scrollingUp ? -dy : dy;
                    return a.rect.left - b.rect.left;
                });
            if (!ordered.length) return;
            const now = performance.now();
            const startOffset =
                now - lastBatchAt < 180
                    ? Math.max(0, nextWaveAt - now)
                    : Math.max(0, Math.min(nextWaveAt - now, 260));
            lastBatchAt = now;
            const step = ordered.length > 5 ? 52 : STAGGER_STEP;
            ordered.forEach(({ element }, index) => {
                const delay = Math.round(startOffset + index * step);
                (element as HTMLElement).style.setProperty("--flow-delay", `${delay}ms`);
                (element as HTMLElement).dataset.flowAt = String(Math.round(now + delay));
                element.classList.add("visible");
            });
            nextWaveAt = now + startOffset + ordered.length * step;
        }

        function queueReveals(items: Element[], immediate = false) {
            items.forEach((element) => pendingReveals.add(element));
            if (immediate) {
                if (revealFrame) {
                    cancelAnimationFrame(revealFrame);
                    revealFrame = 0;
                }
                flushReveals();
            } else if (!revealFrame) {
                revealFrame = requestAnimationFrame(flushReveals);
            }
        }

        let enterObserver: IntersectionObserver | null = null;
        let exitObserver: IntersectionObserver | null = null;

        if ("IntersectionObserver" in window) {
            root.classList.add("js-motion");
            enterObserver = new IntersectionObserver(
                (entries) => {
                    if (!enabled()) return;
                    const entering = entries
                        .filter(
                            (entry) =>
                                entry.isIntersecting &&
                                !entry.target.classList.contains("visible")
                        )
                        .map((entry) => entry.target);
                    if (entering.length) queueReveals(entering);
                },
                { rootMargin: "0px 0px -4% 0px", threshold: 0.05 }
            );

            // Dual-observer deadband: only reset once fully 24px offscreen so
            // edges never jitter.
            exitObserver = new IntersectionObserver(
                (entries) => {
                    if (!enabled()) return;
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) return;
                        const element = entry.target as HTMLElement;
                        pendingReveals.delete(element);
                        if (!element.classList.contains("visible")) return;
                        const above = entry.boundingClientRect.bottom <= 0;
                        element.style.setProperty("--flow-from", above ? "-16px" : "20px");
                        element.style.setProperty("--flow-delay", "0ms");
                        element.classList.remove("visible");
                    });
                },
                { rootMargin: "24px 0px 24px 0px", threshold: 0 }
            );
        }

        function observeReveals() {
            if (!enterObserver || !exitObserver) return;
            document.querySelectorAll<HTMLElement>(".reveal").forEach((element) => {
                if (!element.dataset.flowWired) {
                    element.dataset.flowWired = "1";
                    element.style.setProperty("--flow-from", "18px");
                }
                enterObserver?.observe(element);
                exitObserver?.observe(element);
            });
        }

        function sweepBottom() {
            if (!enabled()) return;
            const nearBottom =
                window.scrollY + window.innerHeight >=
                document.documentElement.scrollHeight - 48;
            if (!nearBottom) return;
            const pending = [...document.querySelectorAll<HTMLElement>(".reveal:not(.visible)")].filter(
                (element) => {
                    const rect = element.getBoundingClientRect();
                    return rect.bottom > 0 && rect.top < window.innerHeight;
                }
            );
            if (pending.length) queueReveals(pending);
        }

        function decorateDynamic() {
            let added = false;
            document
                .querySelectorAll<HTMLElement>(".instagram-grid > .insta-card:not([data-nt-decorated])")
                .forEach((element) => {
                    element.dataset.ntDecorated = "1";
                    element.classList.add("reveal");
                    element.style.setProperty("--flow-from", "18px");
                    added = true;
                });
            if (added) {
                rebuildCardLayers();
                observeReveals();
                if (enabled()) {
                    const cards = [...document.querySelectorAll<HTMLElement>(".reveal:not(.visible)")];
                    queueReveals(cards, true);
                }
            }
        }

        function syncProductCards() {
            const cards = [...document.querySelectorAll<HTMLElement>("#product-grid > .product-card")];
            cards.forEach((card) => card.classList.add("reveal"));
            decorateDynamic();
            rebuildCardLayers();
            observeReveals();
            if (!enabled()) {
                cards.forEach((card) => card.classList.add("visible"));
                return;
            }
            if (cards.length) void cards[0].offsetHeight;
            queueReveals(cards, true);
            requestUpdate();
        }

        let frame = 0;
        function animate() {
            frame = 0;
            if (!enabled() || document.hidden) return;
            let moving = false;
            const height = window.innerHeight;
            const width = window.innerWidth;
            const mobile = width <= 600;
            const allLayers = staticLayers.concat(cardLayers);
            const positions = allLayers.map((layer) => layer.region.getBoundingClientRect());
            allLayers.forEach((layer, index) => {
                if (layer.desktopOnly && width <= 900) {
                    if (layer.current !== 0) {
                        layer.current = 0;
                        layer.target.style.setProperty(layer.property, "0px");
                    }
                    return;
                }
                const rect = positions[index];
                if (rect.bottom < -90 || rect.top > height + 90) return;
                const limit = mobile ? Math.min(layer.limit, 18) : layer.limit;
                const target = Math.max(
                    -limit,
                    Math.min(limit, (height / 2 - rect.top - rect.height / 2) * layer.rate)
                );
                const distance = target - layer.current;
                layer.current =
                    Math.abs(distance) < 0.06 ? target : layer.current + distance * 0.095;
                layer.target.style.setProperty(
                    layer.property,
                    `${layer.current.toFixed(2)}px`
                );
                if (Math.abs(distance) >= 0.06) moving = true;
            });
            if (moving) frame = requestAnimationFrame(animate);
        }

        function requestUpdate() {
            const y = window.scrollY;
            if (Math.abs(y - lastScrollY) > 2) {
                scrollingUp = y < lastScrollY;
                lastScrollY = y;
            }
            sweepBottom();
            if (enabled() && !document.hidden && !frame) frame = requestAnimationFrame(animate);
        }

        function sync() {
            const on = enabled();
            root.dataset.motion = on ? "on" : "off";
            button.disabled = preference.matches;
            button.setAttribute("aria-pressed", String(on));
            button.setAttribute(
                "aria-label",
                preference.matches
                    ? "Animations reduced to match your device preference"
                    : on
                        ? "Pause animations and parallax"
                        : "Enable animations and parallax"
            );
            button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${
                on
                    ? '<path d="M7 5v10M13 5v10"/>'
                    : '<path d="m7 4 8 6-8 6V4Z"/>'
            }</svg><span>${
                preference.matches ? "Reduced motion" : on ? "Motion on" : "Motion paused"
            }</span>`;
            if (!on) {
                cancelAnimationFrame(frame);
                cancelAnimationFrame(revealFrame);
                frame = 0;
                revealFrame = 0;
                pendingReveals.clear();
                staticLayers.concat(cardLayers).forEach((layer) => {
                    layer.current = 0;
                    layer.target.style.setProperty(layer.property, "0px");
                });
                document.querySelectorAll<HTMLElement>(".reveal").forEach((element) => {
                    element.style.setProperty("--flow-delay", "0ms");
                    element.classList.add("visible");
                });
            } else {
                void root.offsetHeight;
                queueReveals([...document.querySelectorAll(".reveal:not(.visible)")], true);
                requestUpdate();
            }
        }

        const onToggle = () => {
            paused = !paused;
            try {
                localStorage.setItem("niththigal-motion", paused ? "off" : "on");
            } catch {
                /* storage unavailable */
            }
            sync();
        };
        const onPreference = () => sync();
        const onResetMotion = () => {
            paused = false;
            sync();
        };
        const onScroll = () => requestUpdate();
        const onResize = () => requestUpdate();
        const onLoad = () => requestUpdate();
        const onVisibility = () => {
            if (document.hidden) {
                cancelAnimationFrame(frame);
                frame = 0;
            } else {
                requestUpdate();
            }
        };

        button.addEventListener("click", onToggle);
        preference.addEventListener("change", onPreference);
        window.addEventListener("niththigal:reset-motion", onResetMotion);
        window.addEventListener("niththigal:products", syncProductCards);
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onResize, { passive: true });
        window.addEventListener("load", onLoad, { once: true });
        document.addEventListener("visibilitychange", onVisibility);

        const mutationObserver = new MutationObserver(() => {
            decorateDynamic();
        });
        mutationObserver.observe(document.body, { childList: true, subtree: true });

        // A soft highlight follows the pointer over jewellery; touch is untouched.
        let pointerFrame = 0;
        let pointer: { image: Element; x: number; y: number } | null = null;
        const onPointerMove = (event: PointerEvent) => {
            if (!enabled() || !finePointer.matches || event.pointerType === "touch") return;
            const target = event.target as Element | null;
            const image = target?.closest(".product-image");
            if (!image) return;
            pointer = { image, x: event.clientX, y: event.clientY };
            if (!pointerFrame) {
                pointerFrame = requestAnimationFrame(() => {
                    pointerFrame = 0;
                    if (!enabled() || !pointer || !pointer.image.isConnected) return;
                    const rect = pointer.image.getBoundingClientRect();
                    const element = pointer.image as HTMLElement;
                    element.style.setProperty("--glow-x", `${pointer.x - rect.left}px`);
                    element.style.setProperty("--glow-y", `${pointer.y - rect.top}px`);
                });
            }
        };
        document.addEventListener("pointermove", onPointerMove, { passive: true });

        decorateDynamic();
        observeReveals();
        syncProductCards();
        sync();

        return () => {
            button.removeEventListener("click", onToggle);
            preference.removeEventListener("change", onPreference);
            window.removeEventListener("niththigal:reset-motion", onResetMotion);
            window.removeEventListener("niththigal:products", syncProductCards);
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onResize);
            document.removeEventListener("visibilitychange", onVisibility);
            document.removeEventListener("pointermove", onPointerMove);
            mutationObserver.disconnect();
            enterObserver?.disconnect();
            exitObserver?.disconnect();
            cancelAnimationFrame(frame);
            cancelAnimationFrame(revealFrame);
            cancelAnimationFrame(pointerFrame);
            button.remove();
            root.classList.remove("js-motion");
            delete root.dataset.motion;
        };
    }, []);

    return null;
}
