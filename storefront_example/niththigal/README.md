# Niththigal — Jewellery, with soul

A responsive, editorial storefront for South Indian-inspired imitation jewellery. Built with semantic HTML, CSS and vanilla JavaScript. No runtime framework, CDN, API key or build step required.

## View / run

- **Live preview:** the running Niththigal Jewellery website on port 3000.
- **Portable preview:** open `Niththigal.html` directly in a browser. All fonts, images, styles and scripts are embedded.
- **Source:** `index.html`, `styles.css`, `soft.css`, `app.js`, `motion.js`, `fonts.css`, and `assets/`.
- Start the source site with `npm start`, or `python -m http.server 3000 --bind 0.0.0.0`.
- Deploy the source files and `assets/` to any static web host. Asset paths currently assume deployment at the domain root. The Python server is for local preview, not production hosting.

## Included

- Sticky translucent navigation and mobile menu
- Original AI-generated campaign and product imagery, compressed to WebP
- Locally hosted, Latin-subset Cormorant Garamond and Manrope fonts; OFL licenses included
- Responsive hero, brand promises, product showcase with INR prices, brand story, benefits, illustrative community stories, FAQ, final CTA and footer
- Category filtering, search, saved favourites, product detail dialogs and bangle sizing
- Persistent shopping bag with quantities, removal, subtotal and preview order review
- Accessible native dialogs, visible keyboard focus, skip link, semantic headings and reduced-motion support
- Direction-aware re-entrant staggered scroll entrances across every section, ambient breathing, subtle multi-layer scroll parallax, pointer-following jewellery highlights, floating hover cards, image zooms and cart feedback
- Soft rounded surfaces, frosted glass navigation and overlays, gentle ivory/sage/gold gradients, and translucent dialogs
- Persistent animation pause control with automatic reduced-motion preference detection; parallax uses requestAnimationFrame and stops when settled or the document is hidden
- Local storage only; no analytics, personal-data submission or payment collection

## Verification

Install development test dependencies with `npm install`, then `npx playwright install --with-deps chromium`. With the preview server running on port 3000, run `npm test`.

Verified filters, search, saving, size selection, quantity changes, bag persistence, preview checkout and mobile navigation. No horizontal overflow at 320px, 390px and 768px. Desktop was visually checked at 1440px. Automated axe WCAG 2 A/AA and 2.1 AA checks reported no violations on the tested desktop, mobile and product-dialog views. Automated checks are not a substitute for a complete manual accessibility audit.

## Before commercial launch

This is a deployment-ready front end, **not a connected ecommerce backend**.

1. Replace the sample catalogue in `app.js` with approved products, verified materials, dimensions, available sizes, stock, prices and actual photography. Generated jewellery imagery must not be used to represent unverified product specifications.
2. Replace illustrative community stories with genuine, permissioned customer reviews. Do not publish the stories as real testimonials.
3. Add confirmed business details and support contacts. Publish shipping, returns, cancellation, privacy and sale terms.
4. Connect a secure commerce backend and payment provider. Validate prices, stock, taxes, delivery charges and all orders on the server. Never trust browser totals or store secrets in client JavaScript.
5. Add confirmation emails, order management, error states and payment webhook verification.
6. Change the preview FAQs and notices only after the shop is genuinely operational.
7. Add your canonical domain and real social metadata, configure HTTPS/security headers and appropriate cache policies on the production host, and complete cross-browser, screen-reader and checkout testing.

## Editing

- Theme colours and fonts: CSS variables at the start of `styles.css`.
- Soft visual treatment, glass surfaces and animations: `soft.css`.
- Scroll-driven effects, pointer highlights and the motion toggle: `motion.js`.
- Products and prices: `products` array at the beginning of `app.js`.
- Landing-page copy and sections: `index.html`.
- The portable HTML is a generated export. Run `python export.py` after source edits to rebuild the portable preview and the source archive.
