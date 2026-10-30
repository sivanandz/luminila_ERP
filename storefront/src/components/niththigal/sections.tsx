"use client";

import { useEffect, useRef, useState } from "react";
import type {
    NiththigalContent,
    NtBenefitItem,
    NtInstagramPost,
    NtPricingItem,
    NtPromiseItem,
    NtTestimonial,
} from "@/lib/niththigal-content";
import { useNtCatalog } from "./NtCatalogContext";
import {
    BenefitIcon,
    CopyIcon,
    InstagramIcon,
    PriceIcon,
    PromiseIcon,
    ReelIcon,
} from "./NtIcons";


/**
 * Editorial split hero. Copy is global; the image area can run an optional
 * CMS slideshow with per-slide image, caption, tag and alt text.
 */
export function Hero({ content }: { content: NiththigalContent }) {
    const hero = content.hero;
    const slides =
        hero.slideshow?.enabled && Array.isArray(hero.slides) && hero.slides.length > 0
            ? hero.slides
            : [];
    const [index, setIndex] = useState(0);
    const [previousImage, setPreviousImage] = useState("");
    const [hoverPaused, setHoverPaused] = useState(false);
    const [manualPaused, setManualPaused] = useState(false);
    const [reducedMotion, setReducedMotion] = useState(false);
    const ghostTimer = useRef<number | null>(null);

    useEffect(() => {
        setIndex(0);
        setPreviousImage("");
    }, [slides.length]);

    useEffect(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const sync = () => setReducedMotion(media.matches);
        sync();
        media.addEventListener?.("change", sync);
        return () => media.removeEventListener?.("change", sync);
    }, []);

    useEffect(() => {
        return () => {
            if (ghostTimer.current) window.clearTimeout(ghostTimer.current);
        };
    }, []);

    const current = slides.length
        ? slides[Math.min(index, slides.length - 1)]
        : null;
    const activeImage = current?.imageUrl || hero.imageUrl;
    const activeAlt = current?.imageAlt || hero.imageAlt;
    const captionLabel = current?.captionLabel || hero.imageCaptionLabel;
    const captionText = current?.captionText || hero.imageCaptionText;
    const tagTitle = current?.tagTitle || hero.imageTagTitle;
    const tagSub = current?.tagSub || hero.imageTagSub;
    const tagHref = current?.tagHref || hero.imageTagHref || "#collection";
    const verticalCaption = current?.verticalCaption || hero.verticalCaption;
    const paused = hoverPaused || manualPaused;

    const goTo = (next: number) => {
        if (slides.length < 2) return;
        const bounded = (next + slides.length) % slides.length;
        if (bounded === index) return;
        setPreviousImage(activeImage);
        setIndex(bounded);
        if (ghostTimer.current) window.clearTimeout(ghostTimer.current);
        ghostTimer.current = window.setTimeout(() => setPreviousImage(""), 750);
    };

    useEffect(() => {
        if (
            !hero.slideshow?.enabled ||
            slides.length < 2 ||
            paused ||
            reducedMotion
        ) {
            return;
        }
        const interval = Math.max(
            3,
            Number(hero.slideshow.intervalSeconds) || 6
        );
        const timer = window.setInterval(() => {
            setPreviousImage(activeImage);
            setIndex((previous) => (previous + 1) % slides.length);
            if (ghostTimer.current) window.clearTimeout(ghostTimer.current);
            ghostTimer.current = window.setTimeout(() => setPreviousImage(""), 750);
        }, interval * 1000);
        return () => window.clearInterval(timer);
    }, [
        activeImage,
        hero.slideshow?.enabled,
        hero.slideshow?.intervalSeconds,
        paused,
        reducedMotion,
        slides.length,
    ]);

    return (
        <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
                <div className="eyebrow entrance">
                    <span className="gold-line" /> {hero.eyebrow}
                </div>
                <h1 id="hero-title" className="entrance">
                    {hero.titleLine1}
                    <br />
                    {hero.titleLine2Prefix} <em>{hero.titleEmphasis}</em>
                </h1>
                <p className="hero-description entrance">{hero.description}</p>
                <div className="hero-buttons entrance">
                    <a className="button button-green" href={hero.primaryHref || "#collection"}>
                        {hero.primaryCta} <span aria-hidden>↗</span>
                    </a>
                    <a className="text-link" href={hero.secondaryHref || "#story"}>
                        {hero.secondaryCta} <span aria-hidden>→</span>
                    </a>
                </div>
                <div className="hero-note entrance">
                    <span className="little-flower" aria-hidden>✺</span>
                    <div>
                        <strong>{hero.noteTitle}</strong>
                        <span>{hero.noteText}</span>
                    </div>
                </div>
                <div className="hero-bottom entrance">
                    <span>{hero.bottomText}</span>
                    <a href={hero.imageTagHref || "#collection"} aria-label={hero.scrollLabel}>
                        ↓
                    </a>
                </div>
            </div>

            <div
                className="hero-visual"
                onMouseEnter={() => setHoverPaused(true)}
                onMouseLeave={() => setHoverPaused(false)}
                onFocusCapture={() => setHoverPaused(true)}
                onBlurCapture={() => setHoverPaused(false)}
            >
                <img
                    className="hero-slide-image"
                    src={activeImage}
                    alt={activeAlt}
                    width={1122}
                    height={1402}
                    fetchPriority="high"
                    decoding="async"
                />
                {previousImage ? (
                    <img
                        className="hero-ghost"
                        src={previousImage}
                        alt=""
                        aria-hidden
                        width={1122}
                        height={1402}
                        decoding="async"
                    />
                ) : null}
                <div className="hero-image-shade" />

                {slides.length > 1 ? (
                    <div
                        className="hero-slide-controls"
                        role="group"
                        aria-label="Hero slideshow"
                    >
                        {slides.map((slide, slideIndex) => (
                            <button
                                key={slide.id || slideIndex}
                                type="button"
                                className="hero-slide-dot"
                                aria-label={`Show slide ${slideIndex + 1}: ${slide.captionText || slide.imageAlt || "hero image"}`}
                                aria-current={slideIndex === index}
                                onClick={() => goTo(slideIndex)}
                            />
                        ))}
                        <span className="hero-slide-count" aria-hidden>
                            {String(index + 1).padStart(2, "0")} /{" "}
                            {String(slides.length).padStart(2, "0")}
                        </span>
                        <button
                            type="button"
                            className="hero-slide-pause"
                            aria-label={
                                reducedMotion
                                    ? "Slideshow autoplay is reduced by your device preference"
                                    : manualPaused
                                        ? "Play hero slideshow"
                                        : "Pause hero slideshow"
                            }
                            aria-pressed={manualPaused}
                            disabled={reducedMotion}
                            onClick={() => setManualPaused((value) => !value)}
                        >
                            {reducedMotion ? "—" : manualPaused ? "▶" : "❚❚"}
                        </button>
                    </div>
                ) : null}

                <div className="image-caption">
                    <span>{captionLabel}</span>
                    <p>{captionText}</p>
                </div>
                <a href={tagHref} className="image-tag">
                    <span className="tag-sparkle" aria-hidden>✧</span>
                    <span>
                        {tagTitle}
                        <small>{tagSub}</small>
                    </span>
                    <span aria-hidden>↗</span>
                </a>
                <div className="vertical-caption">{verticalCaption}</div>
            </div>
        </section>
    );
}

/** Promise strip — three heritage, occasion and gifting promises. */
export function PromiseStrip({ items }: { items: NtPromiseItem[] }) {
    if (!items.length) return null;
    return (
        <div className="promise-strip">
            {items.map((item, index) => (
                <PromiseRow key={`${item.icon}-${index}`} item={item} last={index === items.length - 1} />
            ))}
        </div>
    );
}

function PromiseRow({ item, last }: { item: NtPromiseItem; last: boolean }) {
    return (
        <>
            <div>
                <PromiseIcon name={item.icon} />
                <span>{item.text}</span>
            </div>
            {!last ? <span className="strip-dot" aria-hidden>✧</span> : null}
        </>
    );
}

/** Green heritage story band. */
export function Story({ content }: { content: NiththigalContent }) {
    const story = content.story;
    return (
        <section className="story" id="story" aria-labelledby="story-title">
            <div className="story-image reveal">
                <img
                    src={story.imageUrl}
                    alt={story.imageAlt}
                    width={1024}
                    height={1024}
                    loading="lazy"
                    decoding="async"
                />
                <div className="story-stamp">
                    <span>{story.stampTop}</span>
                    <span className="stamp-flower" aria-hidden>✺</span>
                    <span>{story.stampBottom}</span>
                </div>
                <span className="story-photo-caption">{story.photoCaption}</span>
            </div>
            <div className="story-copy reveal">
                <div className="eyebrow">{story.eyebrow}</div>
                <h2 id="story-title">
                    {story.headingPlain}
                    <br />
                    <em>{story.headingEmphasis}</em>
                </h2>
                <p>{story.paragraph1}</p>
                <p>{story.paragraph2}</p>
                <a className="text-link light-link" href={story.ctaHref || "#collection"}>
                    {story.cta} <span aria-hidden>↗</span>
                </a>
                <div className="story-signature">
                    {story.signature} <span aria-hidden>♡</span>
                </div>
            </div>
        </section>
    );
}

/** Three emotional benefits with the example's SVG icon set. */
export function Benefits({ content }: { content: NiththigalContent }) {
    const benefits = content.benefits;
    return (
        <section className="why section-pad" aria-labelledby="why-title">
            <div className="center-heading reveal">
                <div className="eyebrow">{benefits.eyebrow}</div>
                <h2 id="why-title">
                    {benefits.headingPlain}
                    <br className="mobile-only" /> <em>{benefits.headingEmphasis}</em>
                </h2>
            </div>
            <div className="benefit-grid">
                {benefits.items.map((item, index) => (
                    <Benefit key={`${item.title}-${index}`} item={item} />
                ))}
            </div>
        </section>
    );
}

function Benefit({ item }: { item: NtBenefitItem }) {
    return (
        <article className="benefit reveal">
            <span className="benefit-icon">
                <BenefitIcon name={item.icon} />
            </span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
        </article>
    );
}

/** Illustrative community stories. */
export function Testimonials({ content }: { content: NiththigalContent }) {
    const testimonials = content.testimonials;
    return (
        <section className="love section-pad" id="love" aria-labelledby="love-title">
            <div className="section-heading reveal">
                <div>
                    <div className="eyebrow">{testimonials.eyebrow}</div>
                    <h2 id="love-title">
                        {testimonials.headingPlain}
                        <br />
                        <em>{testimonials.headingEmphasis}</em>
                    </h2>
                </div>
                <div className="love-note">
                    <span className="love-stars" aria-hidden>{testimonials.stars}</span>
                    <span>{testimonials.noteLine}</span>
                    <small>{testimonials.note}</small>
                </div>
            </div>
            <div className="testimonial-grid">
                {testimonials.items.map((item, index) => (
                    <Quote key={`${item.authorLabel}-${index}`} item={item} />
                ))}
            </div>
        </section>
    );
}

function Quote({ item }: { item: NtTestimonial }) {
    return (
        <article className="quote-card reveal">
            <span className="quote-mark" aria-hidden>“</span>
            <blockquote>{item.quote}</blockquote>
            <div className="quote-author">
                <span className="avatar" aria-hidden>
                    {item.avatar || (item.authorLabel || "N").slice(0, 1).toUpperCase()}
                </span>
                <div>
                    <strong>{item.authorLabel}</strong>
                    <span>{item.authorTitle}</span>
                </div>
                <span className="quote-flower" aria-hidden>✧</span>
            </div>
        </article>
    );
}

/** Coupon band — copy-to-clipboard microinteraction. */
export function Promo({ content }: { content: NiththigalContent }) {
    const promo = content.promo;
    const [copied, setCopied] = useState(false);
    if (!promo.enabled) return null;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(promo.code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2200);
        } catch {
            setCopied(false);
        }
    };

    return (
        <section className="promo-band" id="promo" aria-labelledby="promo-title">
            <div className="promo-card reveal">
                <div className="promo-copy">
                    <div className="eyebrow">{promo.eyebrow}</div>
                    <h2 id="promo-title">
                        {promo.headingPlain} <br />
                        <em>{promo.headingEmphasis}</em>
                    </h2>
                    <p>{promo.description}</p>
                </div>
                <div className="promo-coupon">
                    <span className="promo-discount">{promo.discount}</span>
                    <div className="promo-code-row">
                        <button
                            type="button"
                            className="promo-code"
                            onClick={copy}
                            aria-label={`Copy coupon code ${promo.code}`}
                        >
                            {promo.code}
                        </button>
                        <button type="button" className="promo-copy-btn" onClick={copy}>
                            <CopyIcon />
                            {copied ? promo.copiedLabel : promo.ctaLabel}
                        </button>
                    </div>
                    <p className="promo-note">{promo.note}</p>
                </div>
            </div>
        </section>
    );
}

/** Instagram diary — editorial social proof strip. */
export function Instagram({ content }: { content: NiththigalContent }) {
    const instagram = content.instagram;
    if (!instagram.enabled || !instagram.posts.length) return null;
    const followHref = instagram.ctaHref || content.contact.instagramUrl;

    return (
        <section className="instagram section-pad" id="instagram" aria-labelledby="instagram-title">
            <div className="instagram-head reveal">
                <div>
                    <div className="eyebrow">{instagram.eyebrow}</div>
                    <h2 id="instagram-title">{instagram.heading}</h2>
                </div>
                <div className="instagram-handle">
                    <strong>{instagram.handle}</strong>
                    {followHref ? (
                        <a
                            className="instagram-follow"
                            href={followHref}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {instagram.ctaLabel} <span aria-hidden>↗</span>
                        </a>
                    ) : null}
                </div>
            </div>
            <div className="instagram-grid">
                {instagram.posts.map((post) => (
                    <InstaCard key={post.id} post={post} />
                ))}
            </div>
        </section>
    );
}

function InstaCard({ post }: { post: NtInstagramPost }) {
    const inner = (
        <>
            <img
                src={post.imageUrl}
                alt={post.caption}
                width={800}
                height={1000}
                loading="lazy"
                decoding="async"
            />
            <span className="insta-badge">
                {post.type === "reel" ? <ReelIcon /> : <InstagramIcon />}
                {post.type === "reel" ? "REEL" : "POST"}
            </span>
            <div className="insta-overlay">
                <small>{post.type === "reel" ? "FROM THE STUDIO" : "THE NITHTHIGAL DIARY"}</small>
                <p>{post.caption}</p>
            </div>
        </>
    );
    return post.url ? (
        <a className="insta-card reveal" href={post.url} target="_blank" rel="noreferrer">
            {inner}
        </a>
    ) : (
        <div className="insta-card reveal">{inner}</div>
    );
}

/** Retail price story — live starting price plus three honest-value promises. */
export function Pricing({ content }: { content: NiththigalContent }) {
    const pricing = content.pricing;
    const { minPrice } = useNtCatalog();
    const amount = pricing.priceOverride.trim()
        ? pricing.priceOverride.trim()
        : minPrice !== null
            ? minPrice.toLocaleString("en-IN")
            : content.collection.minPriceFallback;

    return (
        <section className="price-story section-pad" id="pricing" aria-labelledby="pricing-title">
            <div className="price-story-copy reveal">
                <div className="eyebrow">{pricing.eyebrow}</div>
                <h2 id="pricing-title">
                    {pricing.headingPlain} <br />
                    <em>{pricing.headingEmphasis}</em>
                </h2>
                <p>{pricing.text}</p>
                <div className="price-anchor">
                    <span>{pricing.anchorLabel}</span>
                    <strong>
                        {pricing.currency}
                        {amount}
                    </strong>
                    <small>{pricing.anchorNote}</small>
                </div>
                <a className="button button-green" href={pricing.ctaHref || "#collection"}>
                    {pricing.cta} <span aria-hidden>↗</span>
                </a>
            </div>
            <div className="price-board reveal">
                {pricing.items.map((item, index) => (
                    <PriceItem key={`${item.title}-${index}`} item={item} />
                ))}
            </div>
            {pricing.footNote ? <p className="price-foot reveal">{pricing.footNote}</p> : null}
        </section>
    );
}

function PriceItem({ item }: { item: NtPricingItem }) {
    return (
        <div className="price-item reveal">
            <span className="price-icon">
                <PriceIcon name={item.icon} />
            </span>
            <div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
            </div>
        </div>
    );
}

/** Accessible native details/summary FAQ. */
export function Faq({ content }: { content: NiththigalContent }) {
    const faq = content.faq;
    return (
        <section className="faq section-pad" id="faq" aria-labelledby="faq-title">
            <div className="faq-intro reveal">
                <div className="eyebrow">{faq.eyebrow}</div>
                <h2 id="faq-title">
                    {faq.headingPlain}
                    <br />
                    <em>{faq.headingEmphasis}</em>
                </h2>
                <p>{faq.text}</p>
                {faq.decoration ? (
                    <span className="faq-decoration" aria-hidden>{faq.decoration}</span>
                ) : null}
            </div>
            <div className="faq-list reveal">
                {faq.items.map((item, index) => (
                    <details key={`${item.question}-${index}`} open={index === 0}>
                        <summary>
                            {item.question}
                            <span className="faq-plus" aria-hidden />
                        </summary>
                        <p>{item.answer}</p>
                    </details>
                ))}
            </div>
        </section>
    );
}

/** Final CTA with ambient orbiting rings. */
export function FinalCta({ content }: { content: NiththigalContent }) {
    const cta = content.finalCta;
    return (
        <section className="final-cta reveal" aria-labelledby="final-cta-title">
            <div className="cta-orbit orbit-one" aria-hidden />
            <div className="cta-orbit orbit-two" aria-hidden />
            {cta.decoration ? (
                <span className="cta-flower" aria-hidden>{cta.decoration}</span>
            ) : null}
            <div className="eyebrow">{cta.eyebrow}</div>
            <h2 id="final-cta-title">
                {cta.headingPlain}
                <br />
                <em>{cta.headingEmphasis}</em>
            </h2>
            <p>{cta.text}</p>
            <a className="button button-cream" href={cta.ctaHref || "#collection"}>
                {cta.cta} <span aria-hidden>↗</span>
            </a>
        </section>
    );
}
