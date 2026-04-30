# What changed in the last 2 days (2026-04-29 → 2026-04-30)

46 commits across the v2-migration branch. The headline work: a full
state-of-the-art UI overhaul on top of the Phase 1–4 valuation
backend work that landed at the start of the window. Live now on the
VPS (initial JS bundle 127.83 KB gzipped, well under the 250 KB
budget).

This doc is a team-facing summary. For the exact commits, see the
"Full commit list" section at the bottom.

---

## TL;DR (90 seconds)

- **New `/workspace` route** — three-pane Linear/Notion-style shell
  with 6 surfaces (Content, Calendar, Strategy, Studio, Insights,
  Settings). All surfaces backed by real data; the legacy top-level
  routes still work as the editing surfaces and as the rollback path.
- **New design system** — 28 cva-driven primitives + barrel exports,
  Storybook 8 with seed stories, Chromatic visual-regression gated on
  a CI secret.
- **Keyboard-first** — ⌘K command palette, ? cheat sheet, ⌘B sidebar
  toggle, ⌘⇧L theme cycle, sonner toasts with undo.
- **AI-native surfaces** — streaming shimmer on assistant responses,
  DiffView dialog for inline AI rewrites, trust UI badge (model +
  latency).
- **Three themes** — Dark (default), Light, Studio (high-contrast
  monochrome).
- **Backend hardening** — Multi-tenancy guard now throws across all
  32 sites. Billing scaffold + Arabic prompts + WhatsApp webhook all
  shipped earlier in the window.
- **CI gates** — bundle-size budget, Lighthouse, axe-playwright,
  Chromatic (gated), tenancy spec (19/19 green).

---

## What's new for users

### Three-pane workspace at `/workspace`

Hit `/workspace` to try the new IA. Six surfaces in one shell:

| Surface  | List pane                           | Detail pane                             |
|----------|-------------------------------------|------------------------------------------|
| Content  | Pieces queue (per client)           | Read-only piece preview                  |
| Calendar | All months for the active client    | Day-grid month preview                   |
| Strategy | Brief + knowledge items             | Brief key/value or knowledge item view   |
| Studio   | Asset thumbnails (image + video)    | Full preview with controls               |
| Insights | Metric tiles (clients, posts, AI)   | Per-metric breakdown                     |
| Settings | Profile / Members / Billing / Keys  | Section panel with deep-link to legacy   |

Pane widths persist per-user (localStorage). URL is the source of
truth — `/workspace/calendar/2026-05` deep-links to a month preview.

The detail panes are read-only previews. Each one has an "Open editor"
button that deep-links to the legacy route for full editing. The
legacy routes (`/calendar`, `/brief`, `/gallery`, `/profile`, etc.)
are unchanged.

### Command palette + keyboard shortcuts

- **⌘K** opens the global command palette (cmdk-powered).
- **?** opens the keyboard shortcut cheat sheet.
- **⌘B** toggles the sidebar.
- **⌘⇧L** cycles theme: dark → light → Studio.
- **⌘Z** undoes the last destructive action via toast (6-second window).

Slash menu (`/`) inside text inputs offers AI rewrites without leaving
the field.

### Inline AI rewrite (DiffView)

In the brief editor's Tone Notes textarea, hit "Rewrite" → an AI dialog
opens with the proposed change rendered as a word-level diff.
Accept/cancel/regenerate inline.

### Three themes

- **Dark** — default, deep-black surfaces.
- **Light** — full re-theme via semantic tokens (no per-class overrides).
- **Studio** — high-contrast monochrome, designer-friendly.

Cycle with **⌘⇧L** or pick from the locale/theme menu.

### AR / Hijri

- Arabic strings wired across Dashboard, Brief, Clients, Review.
- AR↔EN locale toggle animates an RTL mirror flip.
- Hijri date overlay on calendar cells.
- Logical CSS (ms-/me-/ps-/pe-) on the most-trafficked surfaces.

---

## What's new for the team / internal

### Design system

- 28 primitives in `apps/desktop/src/components/ui/` (Button, Dialog,
  Drawer, Tabs, Switch, Checkbox, Radio, Select, Combobox, Slider,
  Tooltip, HoverCard, Popover, ScrollArea, Avatar, Badge, Separator,
  Toggle, Sheet, Toast, Progress, Skeleton, EmptyState, NudgeBanner,
  SlashMenu, Image, Sparkline, AIRewriteDialog).
- All driven by `cva` (class-variance-authority) + `cn()` helper.
- Import from the barrel: `import { Button, Dialog, ... } from '@/components/ui'`.
- Don't import from `legacy.tsx` — it's archived for reference only.

### Tokens

- `apps/desktop/src/index.css` defines all colors, spacing, radii,
  shadows, motion durations, and easings as `@theme` tokens.
- 21 semantic color tokens. Three palettes (`:root`, `.light`,
  `.theme-studio`) each define the same vocabulary.
- **Don't use raw `bg-zinc-*`, `text-zinc-*`, `bg-[#hex]`, or
  `border-white/x` in `src/pages/`.** ESLint will warn. Use semantic
  tokens (`bg-bg`, `text-fg-muted`, `border-border`, etc).

### Motion

- All motion lives in `apps/desktop/src/lib/motion.ts`. Use the four
  presets — `motionInstant`, `motionUI`, `motionBase`, `motionHero` —
  not raw `transition={{ duration: 0.3 }}` literals.
- Both `framer-motion` and `motion` were installed; we standardized
  on `framer-motion` and removed the duplicate.

### Storybook + Chromatic

- `npm run storybook` (port 6006) — local docs explorer.
- `npm run storybook:build` — static build.
- `npm run chromatic` — local snapshot upload (requires `CHROMATIC_PROJECT_TOKEN`).
- CI runs Chromatic only when the secret is set on the repo (forks
  and contributors without the token skip gracefully).

To activate Chromatic: get a project token from chromatic.com, then
**GitHub → repo → Settings → Secrets and variables → Actions → New
repository secret → `CHROMATIC_PROJECT_TOKEN`**. The setup steps are
in a comment block at the top of the workflow step in `ci.yml`.

### Keyboard shortcut registry

- `apps/desktop/src/lib/shortcuts.ts` — central registry. Register a
  shortcut with `useShortcut({ keys: '?', label: '...', handler: ... })`.
- The cheat sheet on `?` reads from this registry — one source of
  truth, no drift.

### CI gates (all live on `main` and `v2-migration`)

| Gate                          | Where                          | Current state                      |
|-------------------------------|--------------------------------|-------------------------------------|
| Server typecheck              | `static` job                   | Required, passing                   |
| Server lint                   | `static` job                   | Required, passing                   |
| Server `npm audit` (high+)    | `static` job                   | Soft (continue-on-error)            |
| Frontend typecheck            | `static` job                   | Required, passing                   |
| Frontend a11y lint            | `static` job                   | Budget: ≤1300 warnings (see below)  |
| Frontend bundle build         | `static` job                   | Required                            |
| Bundle-size budget            | `static` job                   | ≤250 KB gzipped (current 127.83 KB) |
| Chromatic                     | `static` job                   | Skipped if token unset              |
| Smoke (radix-api + postgres)  | `smoke` job                    | Required                            |
| Tenancy spec (19 tests)       | `server/tests/tenancy.spec.ts` | Required, passing                   |

### A11y lint warning budget

We have a `--max-warnings 1300` budget on `lint:a11y`. Today's
breakdown: ~133 jsx-a11y residue + ~1099 raw-color literals in
`src/pages/`. Plan: cut budget by 200/sprint until raw-color count
hits zero, then flip the no-restricted-syntax rule from `warn` to
`error` and drop the budget back to ~200. Don't add new raw colors
to pages — use semantic tokens.

### Multi-tenancy

- `RADIX_TENANT_GUARD=throw` mode is on. Every backend route now
  scopes by `orgId`.
- Invitations + email + role + remove flows live in the UI.
- Tenancy spec (19 tests) is a CI gate — adding a route that doesn't
  scope by org will fail the build.

### Performance

- 28 routes are `React.lazy`-loaded with route-level skeletons.
- `<Image>` primitive uses `loading="lazy"` + blur fade-in.
- `@tanstack/react-query` provider mounted at the root.
- `@tanstack/react-virtual` installed; not yet wired per-page (next sprint).
- `@dnd-kit/*` installed; needs backend `order` field on Pieces and
  KnowledgeItems before drag-reorder can wire up.

---

## Migration notes

- **Existing routes are unchanged.** Don't refactor a page to use
  the workspace shell as a one-shot; instead pull the page's logic
  into the appropriate `Workspace.*Detail.tsx` and update the legacy
  route to redirect into the shell when ready. This is the rollback
  pattern.
- **Don't import from `apps/desktop/src/components/ui/legacy.tsx`.**
  It's the archive of the pre-refactor primitives. Use the barrel
  (`./components/ui`) instead.
- **Don't add raw color classes to `src/pages/`.** ESLint will warn.
  Use semantic tokens.
- **Don't hard-code transition durations.** Import the presets from
  `lib/motion.ts`.
- **Adding a new UI primitive?** Drop it in `components/ui/<Name>.tsx`,
  re-export from `components/ui/index.ts`, add a story at
  `components/ui/<Name>.stories.tsx`. Storybook picks it up
  automatically.
- **Adding a new workspace surface?** Today the shell has 6 surfaces
  in `pages/Workspace.tsx`. The pattern: a list component (sync,
  inline) + a `Workspace.<Name>Detail.tsx` lazy chunk for the right
  pane. Mirror an existing surface (Calendar is the simplest).

---

## Known follow-ups

These are explicitly deferred — captured here so they don't get lost.

- Codemod the 1099 raw color literals in `src/pages/` and graduate
  ESLint rule from `warn` to `error`.
- Wire `@dnd-kit` drag handlers (needs backend `order` field on
  Pieces and KnowledgeItems).
- Calendar drag-posts (depends on the DnD wiring above).
- Stories for the other 24 primitives (currently only Button +
  EmptyState have stories).
- Manual screen-reader pass + full RTL audit on the new workspace
  surfaces.
- Per-page `react-query` migration (provider mounted, no per-page
  wiring yet).
- Per-page `react-virtual` adoption on long lists (ContentPieces,
  KnowledgeItems, AuditLog).
- Lighthouse + axe-playwright CI scores currently use `|| true` for
  baseline collection — ratchet up to hard fail once the baseline is
  stable.

---

## Full commit list (newest first)

```
a195f3c chore(ci): bump lint:a11y budget to 1300 + raw-color ratchet plan
b602591 chore(ci): wire Chromatic visual-regression baseline (gated on secret)
b94d064 feat(workspace): real Settings surface — profile/members/billing/api-keys
c9a2ef5 feat(workspace): real Insights surface — metric tiles + breakdown panes
d3912dc feat(workspace): real Studio surface — asset thumbnails + preview
08f7d40 feat(workspace): real Strategy surface — brief + knowledge feed
a547815 feat(workspace): real Calendar surface — month list + day-grid detail
03b4211 Review feedback: v2-migration UI overhaul (PR #2)
10d8404 chore(ui): minimal Storybook 8 + 2 stories
31929df feat(ai): wire DiffView into AI rewrite flow via AIRewriteDialog
1eea5d6 feat(shell): three-pane workspace layout — opt-in /workspace route
cc5b785 chore(ui): cva + barrel exports + named-export discipline + CI gates
7d9c1e3 fix(ui): /debug + /verify findings — Sparkline collision + ESLint
dc50df3 feat(ui): Dialog + Drawer + NudgeBanner — design system at 28
a764fb5 feat(ui): SlashMenu + Toggle primitives — design system at 25
d6dbe6d feat(ui): 7 more primitives — Avatar / Badge / Separator / Radio / ...
54b706f feat(ui): wire LazyImage primitive into VisualReferences grid
6aa9908 feat(ui): HoverCard primitive + calendar day-cell hover preview
643ebc6 refactor(ui): Dashboard skeleton + TopicDesk motion preset
0f1aebd feat(ui): Tabs / Progress / Switch / Checkbox primitives
e825002 feat(ui): multi-select + bulk delete in Knowledge + motion sweep
c62f809 feat(ui): Breadcrumb + calendar density toggle + nav prefetch
043467b feat(ui): wire AI primitives + onboarding tour + motion sweep
4d83dcd feat(ui): foundation primitives — react-query / dnd-kit / virtual / diff
d46d801 feat(ui): Image primitive (lazy + fade-in) + Phase 5 undo-toast
139c424 feat(ui): Tooltip primitive + EmptyState coverage
200af20 feat(a11y): runtime axe-core audit in dev + jsx-a11y plugin
989018d refactor(ui): wire motion presets into Gallery + ContentCalendar
274c611 feat(ui): inline sparklines on Dashboard stat cards
36714fc feat(ui): cinematic AR↔EN locale flip animation
9a1a641 feat(ui): Skeleton primitive + replace 4 spinner loaders
72b745b feat(ui): EmptyState primitive + migrate Dashboard / Clients / Knowledge
b8cc2e0 fix(ui): React error #185 — cache shortcut snapshot
08f26da fix(ui): stabilize useShortcut deps via callback ref
f790260 feat(ui): Phase 8.1 code-split + Phase 5 shortcut registry + ? cheat sheet
c3017fe feat(ui): Phase 4.1 — motion presets foundation, drop duplicate motion pkg
b982edc chore(ui): drop unused CmdIcon import + redundant cmdk props
c4b0066 feat(ui): ⌘K command palette + sonner toasts + Radix primitives
90b9058 feat(ui): Phase 1 design tokens + Studio theme foundation
0edab3f i18n(pages): wire Arabic strings into Dashboard, Brief, Clients, Review
f56c807 config: route video generation through Grok primary
6cd1587 fix(agent): scope pieces_generate calendarMonth lookup by orgId
cf7444e chore(server): re-establish git tracking for live backend
0cd4168 feat(phase-1-4): multi-tenancy + billing + AR/Hijri wedge + diligence
9c953da feat: token tracking, model updates, visual search fix, dashboard AI engine
cad8af2 Million dollar hardening (#1)
```

---

## Where to look

| What                    | File / route                                                   |
|-------------------------|----------------------------------------------------------------|
| New shell               | `apps/desktop/src/components/shell/WorkspaceShell.tsx`         |
| Surface host            | `apps/desktop/src/pages/Workspace.tsx`                         |
| Per-surface detail      | `apps/desktop/src/pages/Workspace.<Name>Detail.tsx`            |
| Design system barrel    | `apps/desktop/src/components/ui/index.ts`                      |
| `cn()` helper           | `apps/desktop/src/components/ui/cn.ts`                         |
| Tokens + theme palettes | `apps/desktop/src/index.css`                                   |
| Theme switching         | `apps/desktop/src/lib/theme-context.tsx`                       |
| Motion presets          | `apps/desktop/src/lib/motion.ts`                               |
| Shortcut registry       | `apps/desktop/src/lib/shortcuts.ts`                            |
| Command palette         | `apps/desktop/src/components/CommandPalette.tsx`               |
| AI rewrite dialog       | `apps/desktop/src/components/ui/AIRewriteDialog.tsx`           |
| Backend API client      | `apps/desktop/src/lib/backend-api.ts`                          |
| Tenancy spec            | `server/tests/tenancy.spec.ts`                                 |
| CI workflow             | `.github/workflows/ci.yml`                                     |
| Storybook config        | `apps/desktop/.storybook/main.ts`                              |

Questions: ping @weni or read the inline JSDoc on each new file —
they're documented at the top.
