---
name: design-rules
version: 1.0.0
priority: P0
trigger: glob
globs: "**/*.{tsx,jsx,vue,svelte,css,scss},**/components/**,**/app/**/page.tsx"
---

# Design Rules (TIER 2) - AG Kit

> Loaded when touching UI files. Design rules live in the specialist agents, NOT here.

## 🛑 GATE: DESIGN.md before any UI code (MANDATORY)

Before writing or editing UI (components, pages, styles — web or mobile), a **`DESIGN.md` must exist at the project root**.

1. **Check** for `DESIGN.md` at the project root.
2. **If missing:** infer the design direction from the brief, then **create `DESIGN.md` first** (tokens + rationale) following the `design-spec` skill. Do not write UI code until it exists.
3. **If present:** READ it and build strictly against its tokens. Descriptive names in prose map to token names.
4. **Keep it in sync** when the visual language changes — it is the single source of truth.

> Exception: none for new UI. A genuinely trivial tweak to existing UI (one button color, a spacing nudge) may proceed if a `DESIGN.md` already governs the project. Net-new UI always requires the gate.

| Need | Read |
| ---- | ---- |
| DESIGN.md format / tokens | `.agents/skills/design-spec/SKILL.md` |

---

| Task         | Read                            |
| ------------ | ------------------------------- |
| Web UI/UX    | `.agents/agent/frontend-specialist.md` |
| Mobile UI/UX | `.agents/agent/mobile-developer.md`    |

**These agents contain:**

- Purple Ban (no purple by default — brand/brief override allowed)
- Template Ban (no standard layouts)
- Anti-cliché rules
- Deep Design Thinking protocol

> 🔴 **For design work:** Open and READ the agent file. Rules are there.

---

## 📱 Responsive Tab Bars & Narrow Horizontal Constraint Invariant
- When horizontal width is constrained (e.g. mobile viewports `< sm`, narrow sidebars, or split panes), multi-tab bars MUST NOT be squeezed into fixed grid cells or awkward horizontal scrollbars.
- Multi-tab navigation must be dual-rendered:
  - `block sm:hidden`: Full-width themed `Select` dropdown with icons, labels, and active status indicators matching the app theme.
  - `hidden sm:inline-flex`: Sleek pill `TabsList`.
- All dropdown menus (`SelectContent`, `DropdownMenuContent`, etc.) must be strictly styled with proper dark/light theme tokens (`bg-popover`/`bg-card`, `border-border`, `text-popover-foreground`).

## 💬 Message & Broadcast Templates (Mandatory Editability Invariant)
- Never create, display, or queue pre-generated message templates without providing full editing capabilities to the merchant.
- Auto-triggers, marketing broadcasts, and canned responses must ALWAYS include:
  1. An explicit "Edit Template" action with direct copy editing and merge tag support (`{{customer_name}}`, `{{promo_code}}`, etc.).
  2. Live rendered previews showing realistic sample customer data before any action is committed.
  3. Pre-dispatch review and recipient-level overrides so no merchant ever sends unreviewed or unedited canned text.
