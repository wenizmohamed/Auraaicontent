# Per-surface leveling checklist — bring every page to the Dashboard premium bar

**Standard (Dashboard):** ADLaM display headings · eyebrow-uppercase-label → 34px hero number
metric cards · full-bleed sparkline footers · elevated cards · gradient canvas · smooth theme
transition · `var(--color-*)` tokens (no raw Tailwind colors).

Work the queue top-down; each item = build + audit(raw-color PASS) + auth-screenshot + commit.

## P0 — visible breaks
- [x] Workspace sub-rail labels truncated "TRAC"/"MANA" → full PLAN/MAKE/TRACK/MANAGE (`WorkspaceShell.tsx:105`) — DONE 3240454

## P1 — design-system consistency
- [ ] CreativeTools heading → font-display + eyebrow (`CreativeTools.tsx:510`)
- [ ] VisualReferences heading → font-display + eyebrow (`VisualReferences.tsx:96`)
- [ ] BriefInput heading → drop gradient text, font-display + eyebrow, token color (`BriefInput.tsx:498`)
- [ ] Clients heading → add eyebrow label (`Clients.tsx:133`)
- [ ] Gallery + TopicDesk headings → masthead pattern
- [ ] ContentPieces / ContentReview / Knowledge → status counts as eyebrow→hero metric cards
- [ ] Raw-color tokenization (reduces the 2506 ratchet): ContentReview (~21), CreativeTools (~15),
      Research (~10), Studio, BrandKit → map text-red-*→var(--color-danger), text-amber-*→var(--color-accent/warning),
      text-emerald-*→var(--color-success), bg-*-500/10→var(--color-*-subtle). NOTE AuraAI token is
      `--color-danger` (not --color-error) and `--color-accent` (amber).
- [ ] Empty/loading states: ContentCalendar (empty), Gallery (skeleton), Research (skeleton),
      BriefInput (form skeleton), VisualReferences (no-results state)

## P2 — polish
- [ ] Card elevation: ContentPieces rows, ContentReview cards, CreativeTools mode cards, Research result cards → shadow-sm
- [ ] TopicDesk column padding consistency; BrandKit heading mobile wrap
- [ ] Confirm theme-transition (`.theme-switching`) reaches all pages (it's global, should already)

Source: full-app audit 2026-06-04 (Explore agent). ~27 items; P0 done, 16 P1, 10 P2.
