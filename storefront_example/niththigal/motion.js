/* Soft, re-entrant staggered scroll reveals and bounded multi-layer parallax. */
(() => {
  const root = document.documentElement;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let paused = false;
  try { paused = localStorage.getItem('niththigal-motion') === 'off'; } catch {}

  const button = document.createElement('button');
  button.className = 'motion-toggle';
  button.type = 'button';
  document.body.appendChild(button);

  // Upgrade container sections so individual child elements cascade in one after another.
  const unwrapContainers = [
    '.collection .section-heading',
    '.story-copy',
    '.why .center-heading',
    '.love .section-heading',
    '.faq-intro',
    '.faq-list'
  ];
  unwrapContainers.forEach(selector => {
    const box = document.querySelector(selector);
    if (!box) return;
    box.classList.remove('reveal');
    [...box.children].forEach(child => child.classList.add('reveal'));
  });
  [
    '.hero-copy > .entrance',
    '.hero-visual .image-caption',
    '.hero-visual .image-tag',
    '.promise-strip',
    '.footer-top > *',
    '.footer-bottom'
  ].forEach(selector => {
    document.querySelectorAll(selector).forEach(el => el.classList.add('reveal'));
  });

  const staticLayers = [
    { region: document.querySelector('.hero-visual'), target: document.querySelector('.hero-visual > img'), property: '--parallax-y', rate: .12, limit: 30, current: 0 },
    { region: document.querySelector('.hero-visual'), target: document.querySelector('.image-caption'), property: '--caption-y', rate: -.04, limit: 10, current: 0 },
    { region: document.querySelector('.story-image'), target: document.querySelector('.story-image > img'), property: '--parallax-y', rate: .105, limit: 36, current: 0 },
    { region: document.querySelector('.story-image'), target: document.querySelector('.story-stamp'), property: '--stamp-y', rate: -.055, limit: 16, current: 0 },
    { region: document.querySelector('.final-cta'), target: document.querySelector('.orbit-one'), property: '--orbit-y', rate: .075, limit: 28, current: 0 },
    { region: document.querySelector('.final-cta'), target: document.querySelector('.orbit-two'), property: '--orbit-y', rate: -.075, limit: 28, current: 0 }
  ].filter(layer => layer.region && layer.target);

  let cardLayers = [];
  function rebuildCardLayers() {
    cardLayers = [];
    ['.product-grid > .product-card', '.benefit-grid > .benefit', '.testimonial-grid > .quote-card'].forEach(selector => {
      const items = [...document.querySelectorAll(selector)];
      items.forEach((el, index) => {
        const col = index % 3;
        const rate = col === 0 ? -.024 : col === 1 ? .008 : .028;
        cardLayers.push({ region: el.parentElement, target: el, property: '--drift-y', rate, limit: 9, current: 0, desktopOnly: true });
      });
    });
  }

  let lastScrollY = window.scrollY;
  let scrollingUp = false;
  let nextWaveAt = 0;
  let lastBatchAt = -1e9;
  let revealFrame = 0;
  const pendingReveals = new Set();
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
      .filter(el => el.isConnected && !el.classList.contains('visible'))
      .map(el => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > 0 && rect.top < height)
      .sort((a, b) => {
        const dy = a.rect.top - b.rect.top;
        if (Math.abs(dy) > 18) return scrollingUp ? -dy : dy;
        return a.rect.left - b.rect.left;
      });
    if (!ordered.length) return;
    const now = performance.now();
    const startOffset = now - lastBatchAt < 180
      ? Math.max(0, nextWaveAt - now)
      : Math.max(0, Math.min(nextWaveAt - now, 260));
    lastBatchAt = now;
    const step = ordered.length > 5 ? 52 : STAGGER_STEP;
    ordered.forEach(({ el }, index) => {
      const delay = Math.round(startOffset + index * step);
      el.style.setProperty('--flow-delay', `${delay}ms`);
      el.dataset.flowAt = String(Math.round(now + delay));
      el.classList.add('visible');
    });
    nextWaveAt = now + startOffset + ordered.length * step;
  }

  function queueReveals(items, immediate = false) {
    items.forEach(el => pendingReveals.add(el));
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

  let enterObserver = null;
  let exitObserver = null;

  if ('IntersectionObserver' in window) {
    root.classList.add('js-motion');
    enterObserver = new IntersectionObserver(entries => {
      if (!enabled()) return;
      const entering = entries
        .filter(entry => entry.isIntersecting && !entry.target.classList.contains('visible'))
        .map(entry => entry.target);
      if (entering.length) queueReveals(entering);
    }, { rootMargin: '0px 0px -4% 0px', threshold: .05 });

    // Dual-observer deadband: only reset once fully 24px offscreen so edges never jitter.
    exitObserver = new IntersectionObserver(entries => {
      if (!enabled()) return;
      entries.forEach(entry => {
        if (entry.isIntersecting) return;
        const el = entry.target;
        pendingReveals.delete(el);
        if (!el.classList.contains('visible')) return;
        const above = entry.boundingClientRect.bottom <= 0;
        el.style.setProperty('--flow-from', above ? '-16px' : '20px');
        el.style.setProperty('--flow-delay', '0ms');
        el.classList.remove('visible');
      });
    }, { rootMargin: '24px 0px 24px 0px', threshold: 0 });
  }

  function observeReveals() {
    if (!enterObserver || !exitObserver) return;
    document.querySelectorAll('.reveal').forEach(el => {
      if (!el.dataset.flowWired) {
        el.dataset.flowWired = '1';
        el.style.setProperty('--flow-from', '18px');
      }
      enterObserver.observe(el);
      exitObserver.observe(el);
    });
  }

  function sweepBottom() {
    if (!enabled()) return;
    const nearBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 48;
    if (!nearBottom) return;
    const pending = [...document.querySelectorAll('.reveal:not(.visible)')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    });
    if (pending.length) queueReveals(pending);
  }

  function syncProductCards() {
    const cards = [...document.querySelectorAll('#product-grid > .product-card')];
    cards.forEach(card => card.classList.add('reveal'));
    rebuildCardLayers();
    observeReveals();
    if (!enabled()) {
      cards.forEach(card => card.classList.add('visible'));
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
    const positions = allLayers.map(layer => layer.region.getBoundingClientRect());
    allLayers.forEach((layer, index) => {
      if (layer.desktopOnly && width <= 900) {
        if (layer.current !== 0) {
          layer.current = 0;
          layer.target.style.setProperty(layer.property, '0px');
        }
        return;
      }
      const rect = positions[index];
      if (rect.bottom < -90 || rect.top > height + 90) return;
      const limit = mobile ? Math.min(layer.limit, 18) : layer.limit;
      const target = Math.max(-limit, Math.min(limit, (height / 2 - rect.top - rect.height / 2) * layer.rate));
      const distance = target - layer.current;
      layer.current = Math.abs(distance) < .06 ? target : layer.current + distance * .095;
      layer.target.style.setProperty(layer.property, `${layer.current.toFixed(2)}px`);
      if (Math.abs(distance) >= .06) moving = true;
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
    root.dataset.motion = on ? 'on' : 'off';
    button.disabled = preference.matches;
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute(
      'aria-label',
      preference.matches
        ? 'Animations reduced to match your device preference'
        : on
          ? 'Pause animations and parallax'
          : 'Enable animations and parallax'
    );
    button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${on ? '<path d="M7 5v10M13 5v10"/>' : '<path d="m7 4 8 6-8 6V4Z"/>'}</svg><span>${preference.matches ? 'Reduced motion' : on ? 'Motion on' : 'Motion paused'}</span>`;
    if (!on) {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(revealFrame);
      frame = 0;
      revealFrame = 0;
      pendingReveals.clear();
      staticLayers.concat(cardLayers).forEach(layer => {
        layer.current = 0;
        layer.target.style.setProperty(layer.property, '0px');
      });
      document.querySelectorAll('.reveal').forEach(el => {
        el.style.setProperty('--flow-delay', '0ms');
        el.classList.add('visible');
      });
    } else {
      void root.offsetHeight;
      queueReveals([...document.querySelectorAll('.reveal:not(.visible)')], true);
      requestUpdate();
    }
  }

  button.addEventListener('click', () => {
    paused = !paused;
    try { localStorage.setItem('niththigal-motion', paused ? 'off' : 'on'); } catch {}
    sync();
  });
  preference.addEventListener('change', sync);
  window.addEventListener('niththigal:reset-motion', () => { paused = false; sync(); });
  window.addEventListener('niththigal:products', syncProductCards);
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  window.addEventListener('load', requestUpdate, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else requestUpdate();
  });

  // A soft highlight follows the pointer over jewellery; touch remains unaffected.
  let pointerFrame = 0, pointer = null;
  document.addEventListener('pointermove', event => {
    if (!enabled() || !finePointer.matches || event.pointerType === 'touch') return;
    const image = event.target.closest('.product-image');
    if (!image) return;
    pointer = { image, x: event.clientX, y: event.clientY };
    if (!pointerFrame) pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      if (!enabled() || !pointer.image.isConnected) return;
      const rect = pointer.image.getBoundingClientRect();
      pointer.image.style.setProperty('--glow-x', `${pointer.x - rect.left}px`);
      pointer.image.style.setProperty('--glow-y', `${pointer.y - rect.top}px`);
    });
  }, { passive: true });

  syncProductCards();
  sync();
})();
