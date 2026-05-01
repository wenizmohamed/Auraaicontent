# What's new in Radix this week

A complete tour of the upgrades. **Hard-refresh** the page once
(Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows) and you'll see them.

---

## 🤖 Chat & AI

**Smarter chat dock** (the floating bot, bottom-right of any page)
The "thinking" animation now shimmers through stages ("Pulling
context", "Generating", "Almost there"). Hover any reply to **copy**
or **retry** it. Shows the model that answered + how long it took.

**Three one-click assistants** in the chat dock empty-state
- **Brand Q&A** — answers strictly from your workspace knowledge,
  cites the source, refuses to invent.
- **Extract from Text** — paste any document → get clean structured
  fields back.
- **Research → Write** — three-stage pipeline (research → draft →
  edit) for sourced long-form content.

**AI quick-actions on any text**
Highlight text in a brief or post → small toolbar pops up. Click
**More** for **17 quick actions**: translate to Arabic / French /
Spanish / English, change tone (professional / friendly / confident /
playful), summarize (TL;DR or 5-bullet), expand (paragraph or
thread), extract entities or action items, and more.

**Diff view for AI rewrites**
When the assistant rewrites your text, you see before / after side
by side with red / green highlights. Accept or reject hunks one at
a time.

**Brand-new Agent page** at `/agent`
- **Plan tab** — preview what the assistant is about to do, step by
  step, then approve or cancel before it runs.
- **History tab** — replay any past assistant run, in chronological
  order, with everything it did and every result it returned.

---

## 📅 Calendar

**Drag-and-drop scheduling**
Open `/calendar`. New rail on the right shows every unscheduled
draft. Drag any of them onto a day to schedule it. The day cell
highlights when you hover over it.

**Smooth month transitions**
Next / previous month slides in instead of jumping.

**Better day cells**
Each day shows tiny platform labels (Instagram, LinkedIn, etc.)
instead of plain dots. "+N more" overflow when there are many posts.
Hover any day with posts to preview the captions.

**Density toggle** (top of the calendar)
Compact / comfortable / spacious — pick how dense you want the grid.

**Cinematic Arabic ↔ English flip**
Switch language → the whole layout mirrors with a polished animation.

**Hijri overlay**
Toggle the **ه Hijri** button to see Hijri dates next to Gregorian
on every cell. Ramadan and GCC holidays auto-tint.

**Month archive (reversible)**
Archive a month to declutter. Posts are preserved; you can restore
them from "Previous Months" anytime.

---

## 📊 Dashboard / Insights

**Walkthrough section**
A new "How it works" walkthrough on the dashboard explains the
end-to-end flow for new team members.

**Bento layout for the AI engine**
Cleaner card layout for total AI calls, tokens used, estimated cost,
success rate, and per-provider stats (Gemini / Grok / Kimi).

**Live orbiting routing diagram** (new)
Shows which AI is handling each request in real time. Pulses on the
most-active provider. Beside it, a "Why this matters" panel explains
the routing chain in plain English.

**Token Efficiency panel**
Per-task breakdown (text, image, video, etc.) showing tokens used,
calls made, average response time. Helps you see where the budget
is going.

**Inline sparklines on stat cards**
Mini trend lines on every metric card so you see direction at a
glance.

**Animated number transitions**
Numbers tick up smoothly when stats change.

---

## 🏢 Workspace & Navigation

**New three-pane workspace at `/workspace`** (Linear / Notion style)
Sidebar (collapsible) → middle list → right detail pane. Six
surfaces: **Calendar**, **Strategy**, **Studio**, **Insights**,
**Settings**, **Content**. Resize the panels and your sizes are
remembered.

**Breadcrumbs you can click**
Each segment in the breadcrumb is a dropdown showing siblings —
jump sideways without going back to the top.

**Nav prefetch**
Hover any sidebar link → that page starts loading silently before
you even click. Feels instant.

**Command palette** (press `⌘K` / `Ctrl+K`)
Search and jump anywhere — clients, briefs, calendar, settings,
posts. Type a few letters; hit Enter.

**Keyboard shortcuts cheat sheet** (press `?`)
See every shortcut in one place. New shortcuts include:
- **⌘K** — command palette
- **⌘B** — toggle sidebar
- **⌘+Shift+L** — cycle theme
- **?** — this cheat sheet

---

## ✍️ Strategy & Knowledge

**Multi-select + bulk delete in Knowledge**
Shift-click to select a range, ⌘-click to toggle individual items,
then bulk-delete from the action bar that slides up.

**Better empty states everywhere**
Every empty list / table / panel now gets a real empty state —
illustration, one-sentence description, and a clear next-step button.
No more flat "No data."

---

## 🎨 Visual polish

**Editorial sign-in screen**
Form on the left, brand panel on the right ("Generate. Schedule.
Ship.") with a quiet paper texture.

**Cleaner pricing page** (`/settings/billing`)
Three tiers — Starter / Studio / Agency. The recommended plan has
a soft accent highlight; the others are calm hairlines.

**Subtle upgrade banner**
A one-line nudge sits at the top of the page if your workspace is
on the free plan. Vanishes once you upgrade. Dismiss for the session
if you've seen it.

**Three themes** (press `⌘+Shift+L` to cycle)
- **Dark** (default)
- **Light** (high-readability)
- **Studio** (high-contrast monochrome — great for screenshots and
  client screen-shares)

**Lazy-loading images**
Galleries and visual references load images only as they scroll into
view, with a smooth fade-in. No more janky lists.

**Skeleton loaders** (everywhere there used to be a spinner)
The page now shows the *shape* of what's loading, not a generic
spinning circle. Feels faster and stops the layout from jumping.

**Spotlight on empty cards**
Move your cursor over an empty surface and a soft accent halo
follows it. Subtle but premium.

**Bento gallery**
Click any thumbnail in the Gallery → it expands smoothly into the
preview, like opening a card from the grid.

---

## 🛟 Quality-of-life

**Undo for destructive actions**
Delete a client / archive a month / clear a chat → a 6-second
"Undo" toast lets you reverse it before it's permanent.

**Auto-resize chat input**
The chat input grows as you type — up to ~6 lines — then scrolls.
**Enter** sends, **Shift+Enter** adds a newline. Live char counter
appears as you approach the limit.

**Friendly error toasts** (powered by sonner)
Failures now show as quiet bottom-right toasts instead of jarring
modal alerts.

**Reduced-motion respect**
If you have "Reduce motion" enabled in your OS settings, every
animation collapses to a clean fade. No spinning, no shimmering.

---

## 🛡 Behind the scenes (you don't see this, but it matters)

- **AI spending safety net** — every workspace now has a monthly
  AI spending limit (default: unlimited). Once you set one, the
  system refuses any AI call that would push you over budget,
  before it spends a cent.
- **Multi-tenancy lockdown** — every workspace's data is now
  strictly isolated. Cross-org leaks are impossible by design.
- **Faster everywhere** — pages load only when you visit them.
  First screen is well under the speed target.
- **Visual regression catch** — every new screenshot is auto-compared
  to a baseline so accidental visual breaks are caught before they
  ship.
- **Accessibility audits** running in dev — color contrast, keyboard
  navigation, and screen-reader labels are now checked automatically.

---

## Where to look (cheat sheet)

| Want to see… | Go to… |
|---|---|
| Smarter chat dock + templates | Click the floating Radix bot, bottom-right |
| Drag-drop calendar + density toggle + Hijri | `/calendar` |
| Agent Plan + History | `/agent` |
| Walkthrough + Token Efficiency + orbital router | `/dashboard` |
| Three-pane workspace | `/workspace` |
| Bulk delete in Knowledge | `/knowledge` — shift-click rows |
| New billing tiers + upgrade banner | `/settings/billing` |
| New sign-in screen | Log out, then `/login` |
| AI text quick-actions (17 of them) | Highlight any text in a brief / post |
| Bento gallery | `/gallery` — click any thumbnail |
| Lazy-loaded visual refs | `/visual-references` |
| Diff view | Ask the assistant to rewrite any text |
| Command palette | `⌘K` (Mac) / `Ctrl+K` (Windows) anywhere |
| Keyboard shortcuts cheat sheet | Press `?` anywhere |
| Cycle themes | `⌘+Shift+L` |

---

## If you don't see anything new

Hard-refresh the browser to clear the old version:
- **Mac**: Cmd + Shift + R
- **Windows / Linux**: Ctrl + Shift + R
- **Or**: open the app in an incognito / private window

---

Questions? Ping Hadi.
