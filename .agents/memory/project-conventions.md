---
type: project
created: 2026-05-25
updated: 2026-07-12
---

# Project Conventions

## Git Workflow
- Always create a new dedicated branch for major code changes.
- Branch name format should follow: `feature/[task-slug]` or `fix/[bug-slug]`.

## Supported AI platforms (AG Kit)
- AG Kit **only supports Gemini CLI and Google Antigravity**.
- Do not claim compatibility with Claude Code, Cursor, Copilot, Windsurf, or other assistants unless the user explicitly expands scope.
- Copy on the website, docs, FAQ, README, and marketing should describe AG Kit as a toolkit for Gemini CLI / Antigravity-style agent setups.

## Responsive Navigation & Tabs
- When horizontal width is constrained (mobile viewports `< sm`, narrow panels, or responsive split-views), multi-tab bars must automatically transform into a themed `Select` dropdown selector instead of an awkward horizontal scroll.
- The dropdown trigger and items must follow the active dark theme, display the module icon and label, and seamlessly bind to the active tab state.
- Wide viewports (`sm:` and above) retain the inline pill `TabsList`.

## Message & Broadcast Templates (MANDATORY EDITABILITY)
- Any template (CRM auto-triggers, WhatsApp campaigns, product broadcasts, or canned snippets) MUST ALWAYS include a direct, easy option for the user to edit and customize the copy before dispatching.
- Never send, queue, or dispatch pre-generated or canned message templates directly without giving the merchant the ability to review, edit merge tags, and customize the text per recipient or batch.
- Every template workflow must provide:
  1. Direct editing of template copy, promo codes, and variables.
  2. Live rendered previews showing realistic recipient data and WhatsApp styling.
  3. Pre-dispatch review modals allowing per-recipient text tweaks or exclusions.
