# jobgraph dashboard design system

Warm cream, editorial, one accent. Modelled on the "Altura" aesthetic: hairlines instead of shadows,
crop-marked frames instead of cards, numbered rows instead of chips, display type set tight and in
sentence case. If a screen starts to look like a generic SaaS dashboard (rainbow badges, rounded
grey cards, drop shadows), it has drifted from this document.

## Principles

1. **One accent.** Burnt amber `--accent` appears only on: primary button hover, the active
   stepper dot, the active nav marker, and small square markers that mean "waiting on you".
   Never as a fill for large areas, never as text colour for body copy.
2. **No colour coding.** Status is carried by a small square marker inside a stone pill, not by hue.
3. **Hairlines, not shadows.** Every edge is 1px `--line`. No `box-shadow`, no gradients
   (the dashboard hero band is the single exception).
4. **Number everything.** Lists, sections, steps and nav items carry `01`, `02`, `03` index labels.
5. **Whitespace is structure.** Sections are 96-112px apart; content sits on a 12-column grid.

## Tokens (`src/app/globals.css`)

CSS variables on `:root`, exposed to Tailwind through `@theme inline` (so `bg-paper`,
`border-line`, `text-muted` etc. work).

| Token | Value | Tailwind | Use |
| --- | --- | --- | --- |
| `--canvas` | `#F3EFE8` | `bg-canvas` | page, sidebar, top bar, drawer |
| `--paper` | `#FAF8F4` | `bg-paper` | frames, inputs |
| `--stone` | `#EBE6DC` | `bg-stone` | pills, row hover (`bg-stone/50`) |
| `--stone-2` | `#E2DCCF` | `bg-stone-2` | selection |
| `--line` | `#D9D3C7` | `border-line` | all hairlines |
| `--line-strong` | `#BFB8AA` | `border-line-strong` | hover hairline, link underline, separators |
| `--ink` | `#141311` | `text-ink`, `bg-ink` | text, primary button, crop ticks, done markers |
| `--ink-2` | `#3A3732` | `text-ink-2` | secondary text on paper |
| `--muted` | `#6F6A60` | `text-muted` | muted copy, labels |
| `--faint` | `#9A9487` | `text-faint` | index numbers, placeholders, captions |
| `--accent` | `#B8632B` | `bg-accent` | see Principle 1 |
| `--accent-ink` | `#8F4A1F` | `text-accent-ink` | the rare accent text (errors, required `*`) |

Other variables: `--radius-tag` 2px, `--radius-input` 3px, `--tick` 6px, `--shell-w` 208px,
`--content-max` 1280px, `--ease` `cubic-bezier(0.2, 0, 0, 1)`.

## Typography

Fonts load through `next/font/google` in `src/app/layout.tsx`:

- **Inter Tight** (`--font-inter-tight`, Tailwind `font-display`): all display headings, big numbers.
  Weight 500, negative tracking.
- **Geist** (`--font-geist`, `font-sans`): body and UI.
- **Geist Mono** (`--font-geist-mono`, `font-mono`): live log, bullet ids, verification codes.

| Utility | Size / line-height / tracking | Use |
| --- | --- | --- |
| `text-display-xl` | 56 / 0.98 / -0.04em | page `h1` (38px below `sm`) |
| `text-display-lg` | 40 / 1.02 / -0.035em | section `h2` (30px below `sm`) |
| `text-display-md` | 28 / 1.08 / -0.025em | block headings, drawer, inbox subject |
| `text-title` | 18 / 1.3 / -0.012em | sub-titles, company line |
| `text-body` | 15 / 1.55 | prose, "after" text in diffs |
| `text-body-sm` | 14 / 1.5 | default UI text |
| `text-meta` | 13 / 1.45 | secondary lines, metadata |
| `text-label` + `uppercase` | 11 / 1.2 / 0.12em | index labels, table headers, field labels |

Headings are sentence case and usually break onto two lines on purpose
("Roles worth / your time."). Numbers that line up use tabular figures: the `tnum` class
(also applied automatically to `table` and `time`).

## Spacing and grid

- 4px base. Common steps: 8, 12, 16, 20, 24, 32, 40, 64, 96, 112.
- Main column: `max-w-[1280px]`, side padding 16px (phone), 32px (`sm`), 40px (`lg`).
- 12-column grid with 24px gutters (`grid-cols-12 gap-x-6`). Section header splits 3 / 6 / 3;
  application review splits 8 (main) / 4 (rail); forms split 3 (label) / 9 (fields).
- Page header to first section: 48-64px. Between sections: `mt-24` / `sm:mt-28`.
- Inside frames: 20px (phone) / 24px padding.

## Components (`src/components`)

All primitives are re-exported from `ui.tsx`.

| Component | File | Notes |
| --- | --- | --- |
| `Frame`, `Ticks` | `Frame.tsx` | 1px hairline box with four 6px L-shaped crop ticks in ink. `surface="paper" \| "none" \| "stone"`, `pad="sm" \| "md" \| "lg"`. The base for every card. |
| `IndexLabel`, `Square` | `IndexLabel.tsx` | 11px uppercase label with optional `index` ("01") and square `marker`. Marker tones: `ink` (done/positive), `accent` (needs you), `hollow` (agent working), `outline` (closed negative), `muted` (parked). |
| `SectionHeader` | `SectionHeader.tsx` | Marker + label (3 cols), two-line display heading (6 cols), one muted sentence and actions (3 cols). `size="xl"` + `as="h1"` for pages (via `PageHeader`), `lg` / `md` for sections. |
| `Pill`, `Tag` | `Pill.tsx` | `Pill`: stone, ink text, 6px square marker; used for status. `Tag`: 1px outlined, 2px radius, optional faint `kind` prefix; used for provenance, skills, files. `TONE_MARK` maps legacy tones to markers. |
| `StatusPill` | `StatusPill.tsx` | Stone pill with the `STATUS_ICON` for the status; states waiting on you get a hairline accent ring. Live states pulse. `STATUS_MARK` still drives square markers (tracker columns). |
| `Button`, `LinkButton`, `TextLink` | `ui.tsx` | 36px pills, 13px medium. `primary`: ink fill, cream text, accent on hover. `secondary`: hairline outline, ink border on hover. `ghost`: underlined text. `icon` leads; `arrow` appends a lucide arrow that nudges 2px on hover. |
| `Stepper` | `Stepper.tsx` | Hairline track, 11px square dots, `01`-`08` labels. Done = ink, current = accent (150ms fill), blocked = accent outline with inner square. Phones get a "Step 03 / 08" summary and dots only. |
| `DiffRow` | `DiffRow.tsx` | One line: index, before (muted, struck, truncated), arrow, after (ink). Reason and provenance tags (`/graph?node=`) show on hover or when the "why" pill is pressed. |
| `DataTable` | `DataTable.tsx` | Hairline rows, uppercase label headers, optional `No.` index column (hidden on phones), `hideOnMobile` per column. |
| `NumberedList` | `NumberedList.tsx` | `01 / title + meta / aside` rows with hairline separators. `marker` replaces the number (the ATS list uses square check markers). |
| `Accordion`, `SquareToggle` | `Accordion.tsx` | Native `<details>` with a rotating chevron; works in server components. |
| `Card` | `ui.tsx` | `Frame` with an index-label header row; used for the review rail and legacy spots. |
| `Field`, `inputClass`, `Toggle` | `ui.tsx` | Labels are 11px uppercase. Inputs: paper fill, hairline, 3px radius, ink border on focus, no ring. Selects get a thin ink chevron (globals.css). Toggle: hairline pill track, ink when on. |
| `Notice`, `EmptyState`, `Stat` | `ui.tsx` | Notice: hairline row with a square marker and an uppercase lead ("Your turn", "Error"). Stat: label + 48px display number. |
| `MatchBadge` | `MatchBadge.tsx` | Score as a tabular display number with a 2px ink-on-line meter. Monochrome. |

### Shell

- Desktop: 208px cream sidebar with a hairline right edge. Wordmark "jobgraph" next to a 12px ink
  square (with a 4px accent corner). Nav items are 11.5px uppercase with `01`-`08` indexes, counts
  as plain numbers, the active item marked by a 6px accent square. Search is an underlined field.
- Top bar: 48px, hairline bottom. Breadcrumb on the left, quiet stats strip on the right
  ("14 applied this week · 4 replied · 2 interviews | ■ 3 need you").
- Below `lg` (and at 375px): the sidebar collapses to a 56px top bar (wordmark + "Menu" pill with a
  square +/− toggle) and a scrollable stats line; the menu opens as a full-screen cream sheet.

### Photography

Only `/dashboard` carries an image: the `.hero-golden` band in `globals.css`, a golden-hour
landscape drawn with layered gradients (dusk sky, low sun, ridge silhouettes). Swap it for a real
photo by setting `background-image` on that class. Everything else stays monochrome; the receipt
screenshot is rendered `grayscale`.

### Motion

150ms opacity / colour / transform transitions with `--ease`. Arrow nudge on button hover, stepper
dot fill, nav marker fade, pulse on live markers. Nothing bounces. `prefers-reduced-motion`
disables all of it.

## Icons

`lucide-react`, always through `Icon` (`src/components/Icon.tsx`): 16px, `strokeWidth` 1.5, `currentColor`
(ink). Used on nav items (in place of the old index numbers), leading on buttons (`Button icon={...}`), as
the trailing arrow (`arrow`), in `StatusPill` (one icon per status; states waiting on you get a hairline
accent ring), `Notice`, `EmptyState` (icon in a hairline circle), accordion chevrons and the onboarding
rail. Icons in client components are passed as components (`icon={Send}`); from a server component to a
client component pass an element instead. No brand logos (lucide v1 dropped them).

## Copy

One sentence per page subtitle, no paragraph under section headers, no hints that restate the label.
If a line explains what the UI already shows, delete it.

## Page patterns

- **Page header**: `PageHeader` (label, two-line title, muted sentence).
- **Sections**: `SectionHeader index="01"` followed by content 32-40px below.
- **Application review** (`/applications/[id]`): title + status/actions, framed stepper, one "Your turn"
  line, then numbered blocks in on-screen order (the form jumps first when it needs you). The hero is the
  rendered resume (PDF iframe in a crop-ticked frame, 8 cols) with the ATS score as one 88px number,
  approve button and the live log (last 3 lines, "Show all") beside it. Changes are one line each
  (`before -> after`); the reason and provenance tags appear on hover or via the "why" pill. The form
  shows only questions that need you plus a collapsed "All N filled fields". The receipt is the
  screenshot, large, with submitted fields folded. Company research and run details are accordions.
- **Auth** (`/login`, `/signup`): wordmark bar, one centered 420px frame, display heading, error line in
  accent ink. `src/proxy.ts` (Next 16's middleware) sends requests without `jg_session` to `/login`.
- **Onboarding** (`/onboarding?step=<id>`): numbered rail on the left (3 cols; phones get a step line and
  six segments), one step per screen with a two-line display heading and a single lead sentence, Back /
  Continue under a hairline. Step forms live in `components/onboarding/steps.tsx` and are reused by the
  Settings "Answers" accordions.

## Screenshots

`design-shots/` holds reference captures of `/dashboard`, `/applications/app-2` and `/jobs` at 1280
and 375px wide (mock data), plus `login-1280`, `onboarding-step1-1280`, `onboarding-step4-1280` and
`application-decluttered-1280`.
