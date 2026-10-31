# Nori dashboard design system

Warm paper, warm ink, one kelp teal accent, three signals, shared with the landing site (`nori-landing`).
A personal tool: calm until something needs you.
If a screen grows rainbow badges, gradients, shadows or a colour that means nothing, it has drifted.

## Principles

1. **Nothing is sent without you knowing.** Every signed-in page shows the dry run band while the server's submit
   lock is off. Approve buttons say what happens ("Approve resume", "Approve form", "Answer and send").
2. **Show the evidence.** Every line Nori wrote shows its source one tap away. What it cannot support is shown as a
   gap ("Not claimed"), never filled in.
3. **One decision at a time.** A review screen asks for one thing; the primary action sits at the bottom, with Skip
   beside it. On phones the action bar sticks above the tab bar.
4. **Calm while slow.** Long steps name what is happening and say it is safe to leave. A running step shows three
   dots (`.dots`), never a spinner that suggests a stall.
5. **Same words everywhere.** The web, the companion, chat and notifications use the same nouns and the same
   waiting count.

## Colour (`src/app/globals.css`)

CSS variables on `:root`. There is one theme, light and warm; the dark theme and the Appearance setting were removed.
Exposed to Tailwind with `@theme inline`, so `bg-surface`, `text-muted`, `border-attn` and so on work. Every text
pairing passes WCAG AA (4.5:1); control edges pass 3:1.

| Role | Token | Light | Use |
| --- | --- | --- | --- |
| Page | `bg` | `#f5f4f0` | page background |
| Surface | `surface` | `#fbfaf7` | cards, inputs |
| Sunken | `sunken` | `#f1f0ea` | quiet fills, hover rows, selected nav |
| Line | `line` | `#e2dfd6` | card edges and dividers |
| Control | `control` | `#8c897f` | input and secondary button edges (3:1) |
| Ink | `ink` | `#1a1914` | text and primary buttons |
| Ink 2 | `ink-2` | `#3a3833` | secondary text on surfaces |
| Muted | `muted` | `#5f5d55` | hints, metadata |
| Accent | `accent`, `accent-tint`, `accent-fg` | `#0f766e` | kelp teal: links, focus, sources, good outcomes, finished steps |
| Needs you | `attn`, `attn-tint`, `attn-fg` | `#b45309` | amber: items waiting on the person, and nothing else |
| Dry run | `sandbox`, `sandbox-fg`, `sandbox-line` | `#efeaf6` | the dry run band |
| Danger | `danger`, `danger-tint`, `danger-fg` | `#b4281c` | failures, errors, destructive actions |

Rules:
- **Amber only means "you must act".** Waiting cards get a 2px `border-attn` edge; nothing decorative is amber.
- **Violet only means dry run.** Live mode shows no band at all.
- **A rejection is not red.** It is an outcome; red is for failures and destructive actions.
- **Never colour alone.** Every pill carries a word; working stages add a breathing dot, skipped is dashed, an offer
  is the only solid pill.
- Primary buttons are ink. The accent is for links, sources and focus, used sparingly.

## Type

Three families, as on the landing site: Geist (`--font-geist`) for all UI text, Newsreader (`--font-newsreader`,
`font-display`) for display type, Geist Mono for times and codes. A rule in `globals.css` sets every
`text-display-*` size and every `h1` in Newsreader at weight 400, so headings need no extra class. UI text uses
400 and 600. Sentence case everywhere; no uppercase labels, no index numbers.

| Utility | Size / line height | Use |
| --- | --- | --- |
| `text-display-xl` | 32 / 1.15 | page `h1` (28px on phones), serif |
| `text-display-lg` | 26 / 1.2 | review title, big numbers, serif |
| `text-display-md` | 22 / 1.25 | drawer and message titles, serif |
| `text-title` | 17 / 1.35 | section headings |
| `text-body` | 15 / 1.55 | reading text |
| `text-body-sm` | 14 / 1.5 | default UI text |
| `text-meta` | 13 / 1.45 | secondary lines, labels |
| `text-label` | 12 / 1.3 | small print |

Numbers that line up use `tnum` (automatic on `table` and `time`).

## Space, shape, layout

- 4px base. Cards pad 16 to 20px; sections sit 20 to 24px apart.
- Corners: `rounded-control` (12px) for buttons, inputs and chips' containers; `rounded-card` (16px) for cards.
  Pills are fully rounded.
- No shadows, except the one floating sheet (the jobs filter panel has none; the drawer uses an overlay).
- Shell: a 232px rail on desktop (Work, Rules and evidence, Talk; Profile and Settings at the foot); on phones a
  top bar with the waiting count and a tab bar (Today, Applications, Jobs, Chat, More).
- Content max width 1200px. Every page works at 360px with no sideways scroll; wide tables scroll in their own box.
- Touch targets 44px on phones (buttons are 40px, the sticky review bar 48px).

## Components (`src/components`)

Primitives are re-exported from `ui.tsx`.

| Component | Notes |
| --- | --- |
| `Frame` | Flat card. `surface="paper" \| "stone" \| "none"`, `tone="attn"` for the amber edge. |
| `Card` | `Frame` with a title row and actions. |
| `Button`, `LinkButton`, `TextLink` | `primary` ink, `secondary` outlined, `ghost` text, `danger` brick outline. Sizes `sm` 32, `md` 40, `lg` 48. |
| `Field`, `inputClass`, `Toggle`, `Switch` | Sentence-case labels above; teal focus ring. |
| `Pill`, `Tag`, `StatusPill` | Status by meaning (see Colour). |
| `Notice` | Tinted row: red danger, amber needs you, teal done, neutral info. |
| `EmptyState` | The Nori mark, what is missing, why it matters, the one action that fixes it. |
| `Logo` | `NoriMark` is the landing site's three node mark, `NoriLogo` adds "Nori" in the serif. The rice ball mascot is kept as `NoriMascot` but is not used as the logo. |
| `DryRunBand` | Full-width violet band; `compact` for the companion. |
| `Stepper` | Segments: done teal, current amber at a gate or teal while working, upcoming faint. |
| `EventLog` | The run log, named steps with times, polite live region. |
| `review/ChangeCard` | One tailored line: what it replaced, the new line, a source button that opens the fact, Keep and Revert. |
| `today/WaitingList` | Amber-edged cards, each one link to its decision with the button label that answers it. |

## Pages

- **Today** (`/dashboard`): status line and Run a cycle now; Waiting on you; today's cap and autopilot trust; last
  24 hours with skip reasons grouped; recent replies; the activity feed.
- **Review** (`/applications/[id]`): progress strip, then a stage panel that changes with the state (resume review,
  form review or questions, running, receipt, stopped), the action bar, and a side column (job, recruiter's view,
  run log, research).
- **Applications**: stage filters (including computed Ghosted), a table on desktop and cards on phones, follow-up
  dates, settled outcomes. `/tracker` redirects here.
- **Jobs**: add jobs (poll a board, paste a link, describe it), a filter bar, ranked rows, the job drawer.
- **Lanes and autopilot** (`/agent`): lanes, the shared cap, where Nori stops to ask, and hands-free sending with its
  checks.
- **Career graph**: add a fact, a list view (default) with a detail panel, and the map.
- **Inbox**, **Chat**, **Resumes**, **Profile** (with how ready it is for forms), **Settings** (model, channels and
  apps, limits, account).
- **Landing**, sign-in pages, onboarding (six steps with a "why this step" note), and the companion popover.

## Copy

Say what happens, in plain words. Errors say what happened, what was not affected and what to do. No internal
names (no environment variables, no step ids). One line of context under a page title, not a paragraph.
