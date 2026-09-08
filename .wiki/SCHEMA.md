# Wiki Schema

## Domain
Fashion jewelry inventory manager (Tauri/Next.js/PocketBase)

## Conventions
- File names: lowercase, hyphens, no spaces
- Every wiki page starts with YAML frontmatter
- Use [[wikilinks]] to link between pages (minimum 2 outbound links per page)
- When updating a page, always bump the `updated` date
- Every new page must be added to `index.md` under the correct section
- Every action must be appended to `log.md`

## Frontmatter
```yaml
---
title: Page Title
created: 2026-04-27
updated: 2026-04-27
type: entity | concept | comparison | query | summary
tags: [from taxonomy below]
sources: []
---
```

## Tag Taxonomy
- Core: architecture, data, api, scraper, ui, backend, frontend
- Domain: trading, stocks, mutual-funds, news, automation, crm, inventory
- Tech: python, typescript, react, tauri, PySide6, expo, node.js
- Meta: comparison, timeline, troubleshooting, roadmap

## raw/ Frontmatter
```yaml
---
source_url: https://example.com
ingested: 2026-04-27
sha256: <body-hash>
---
```

## Page Thresholds
- **Create a page** when an entity/concept appears in 2+ sources OR is central to one source
- **Split a page** when it exceeds ~200 lines

## Update Policy
When new information conflicts with existing content:
1. Newer sources generally supersede older ones
2. Mark contradictions in frontmatter: `contradictions: [page-name]`
3. Flag for user review in lint reports
