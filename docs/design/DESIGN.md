# Yen design rules

These rules are binding for every change under `apps/web`. A pull request that
breaks one is not mergeable. "Should" does not appear in this file: every rule
is a requirement. If a rule is wrong, change this file in its own PR first.

The product has two audiences on one system: a treasurer on a low-end Android
phone, and a stranger deciding whether to trust a fund. Both need the same
thing from the interface: it looks like a ledger someone careful keeps.

## 1. Direction: ink on ledger paper

- The interface is typographic. Structure comes from type size, weight, rules
  and whitespace. It never comes from boxes, shadows, colour fills or icons.
- One brand hue (seal green). Under 3% of pixels on any screen are coloured.
  Money, names and facts are ink. Colour means state, never decoration.
- Numbers are the hero. On every money screen the largest element is a figure.
- Calm and exact. No element exists to fill space, and no element moves
  unless it explains a change.

## 2. Tokens

`apps/web/src/styles/tokens.css` is the only place a raw colour, size, radius,
duration or font is written. Components use tokens through Tailwind theme
classes. `tokens.test.ts` checks every text pair for contrast.

### 2.1 Colour

| Token                    | Value     | Use                                               |
| ------------------------ | --------- | ------------------------------------------------- |
| `--color-canvas`         | `#fafaf7` | Page ground (ledger paper)                        |
| `--color-surface`        | `#ffffff` | Raised sheet: forms, receipts, overlays           |
| `--color-sunken`         | `#f2f2ed` | Inset wells: code, hashes, table header           |
| `--color-ink`            | `#0b0f0c` | Text, figures, icons, rules that carry meaning    |
| `--color-ink-muted`      | `#4d554f` | Secondary text. At least 7:1 on canvas            |
| `--color-ink-faint`      | `#6b736d` | Captions and placeholders. At least 4.5:1         |
| `--color-rule`           | `#e4e6e1` | Hairlines between rows and sections               |
| `--color-border-strong`  | `#5f756a` | Input outlines. At least 3:1 on canvas            |
| `--color-primary`        | `#14532d` | Seal green: the one primary action, verified mark |
| `--color-primary-hover`  | `#0f3f22` | Hover and pressed state of primary                |
| `--color-primary-subtle` | `#e3f3e8` | Verified background                               |
| `--color-night`          | `#08130c` | Dark band on marketing pages and the verdict card |
| `--color-on-night`       | `#f4f6f1` | Text on night                                     |
| `--color-on-solid`       | `#ffffff` | Text on primary and danger                        |
| `--color-danger`         | `#991b1b` | Destructive action, rejected state                |
| `--color-focus`          | `#1d4ed8` | Focus ring only                                   |

Status tokens (`verified`, `pending`, `unmatched`, `rejected`, each with `-bg`,
`-ink`, `-border`) keep their current values. A status is always a word plus
an icon plus the colour. Colour is never the only signal.

Rules:

- No hex, `rgb()`, `hsl()` or `oklch()` outside `tokens.css`.
- No Tailwind palette classes (`bg-green-600`, `text-gray-500`, `border-zinc-200`).
- No opacity modifiers on text colours (`text-ink/60`). Use a text token.
- No gradients, except the one defined `--gradient-night` on the marketing hero.
- No dark mode in this version. Do not add `dark:` classes.

### 2.2 Type

Fonts are self-hosted with `next/font` (no runtime font requests):

| Role    | Family                                       | Use                                                               |
| ------- | -------------------------------------------- | ----------------------------------------------------------------- |
| Sans    | Geist, then Noto Sans Devanagari             | All interface text and all figures                                |
| Display | Instrument Serif, then Tiro Devanagari Hindi | Marketing headlines, fund title, the verify verdict. Nowhere else |
| Mono    | Geist Mono                                   | Hashes, record ids, UPI references. Never prose or money          |

Scale (rem at 16 px root). These are the only sizes:

| Token             | Size / line height | Weight | Use                                          |
| ----------------- | ------------------ | ------ | -------------------------------------------- |
| `text-caption`    | 0.875 / 1.25       | 500    | Table headers, eyebrows, meta. Not body text |
| `text-body`       | 1 / 1.5            | 400    | Default                                      |
| `text-lead`       | 1.25 / 1.5         | 400    | One intro paragraph per page                 |
| `text-title`      | 1.5 / 1.3          | 600    | Section headings                             |
| `text-heading`    | 2 / 1.2            | 600    | Page headings                                |
| `text-figure`     | 2.5 / 1.1          | 600    | Key money figures                            |
| `text-display`    | 3.5 / 1.05         | 400    | Display serif, desktop                       |
| `text-display-sm` | 2.5 / 1.1          | 400    | Display serif under 640 px                   |
| `text-hero`       | 5.5 / 1            | 400    | Marketing hero headline, desktop only        |

Rules:

- Body text is never under 16 px. `text-caption` is for labels of 4 words or
  fewer, never sentences.
- Weights are 400, 500 and 600. No 700, no 300, no italics outside the display serif.
- Every figure uses `tabular-nums`. Money in a column is right-aligned.
- Sentence case everywhere. No all-caps except `text-caption` eyebrows with
  `tracking-wide`, at most one per section.
- Line length for prose is 45 to 75 characters (`max-w-prose`).
- One `h1` per page. Heading levels never skip.

### 2.3 Space, shape, depth

- Spacing uses the 4 px scale and only these steps: 1, 2, 3, 4, 6, 8, 12, 16,
  24, 32 (Tailwind units). No arbitrary values (`p-[13px]`, `mt-[7px]`).
- Section rhythm: 64 px between sections on mobile, 96 px on desktop. 24 px
  between a heading and its content. 16 px between related items.
- Radius: `--radius-control` 8 px for inputs and buttons, `--radius-card`
  12 px for sheets and overlays, `rounded-full` for status pills and avatars.
  Nothing else.
- Depth: no shadows on anything in the page flow. One token,
  `--shadow-overlay`, for dialogs, sheets, popovers and menus only.
- Borders are 1 px `--color-rule`. A bordered box never sits inside another
  bordered box.

### 2.4 Motion

- Durations: `--motion-fast` 120 ms (hover, press), `--motion-base` 200 ms
  (enter, exit, expand), `--motion-slow` 400 ms (page-level reveal, one per view).
- Easing: `--ease-out` `cubic-bezier(0.2, 0, 0, 1)` for everything.
- Animate `opacity` and `transform` only. Never width, height, top, left or colour of text.
- Movement distance is 8 px or less. Scale is between 0.98 and 1.
- No scroll-jacking, parallax, cursor effects, looping animation, confetti or
  auto-playing carousels.
- Motion is CSS only (`tw-animate-css`, transitions, View Transitions). No
  animation library.
- `prefers-reduced-motion: reduce` removes all movement and keeps opacity changes.
- The one signature moment: when a record verifies, the seal mark draws once
  in 400 ms. Nothing else in the product celebrates.

## 3. Layout

- Mobile first. Every screen is designed at 390 px, then 768 px, then 1440 px.
- Containers: `max-w-app` 1120 px for the product, `max-w-marketing` 1200 px
  for marketing, `max-w-prose` 640 px for reading and forms.
- Page gutter: 16 px under 640 px, 24 px to 1024 px, 32 px above.
- Product pages use one column on mobile and at most two on desktop (main
  8 columns, side 4 columns of 12). No three-column product layouts.
- Left-aligned by default. Centre alignment is allowed only for the marketing
  hero, empty states and the sign-in sheet.
- A screen has one primary action. It is the only filled green button in view.
  Everything else is a secondary (outlined) or tertiary (text) button.
- The first viewport of every product screen answers: where am I, what is the
  number, what do I do next.
- Sticky elements: the top bar, and on mobile one bottom action bar for the
  primary action. Nothing else sticks.

## 4. Components

Use the primitives in `apps/web/src/components/ui`. A new visual pattern needs
a primitive there first, shown on `/design-system`, before a screen uses it.

- **Button**: 48 px tall (`tap-target`), label plus optional leading icon.
  Variants: `primary`, `secondary`, `tertiary`, `danger`. No icon-only buttons
  without an `aria-label` and a tooltip. No more than two buttons side by side.
- **Figure**: label (`text-caption`, muted) above the amount (`text-figure`).
  Figures sit on the canvas separated by hairlines. Never in tinted boxes.
- **Row list**: the default for records. One row, one fact per column, hairline
  between rows, whole row is the link. Not cards.
- **Sheet**: white surface, 12 px radius, 1 px rule. Used for forms, receipts
  and overlays only. A page has at most one sheet in the flow.
- **Status pill**: icon, word, status colours. At most one per row.
- **Field**: visible label above, hint below, error replaces hint. Never a
  placeholder as the label. Errors say what to do.
- **Tabs**: one line, horizontal scroll on overflow. Tabs never wrap.
- **Empty state**: one sentence saying what will appear, one action. No
  illustration.
- **Loading**: skeletons that match the final layout. Spinners only inside buttons.
- **Icons**: `lucide-react`, 20 px, 1.5 stroke, always next to a label. Icons
  never carry meaning alone. No emoji anywhere in the interface.

## 5. Content

- Plain words. Never "hash", "block", "Merkle", "on-chain", "anchor" in the
  interface outside the collapsed technical details. Say "seal", "record",
  "published", "checked".
- Money: `₹` then Indian grouping (`₹5,02,500`). Paise show only when they are
  not zero in figures and summaries, and always in ledger rows, receipts and
  exports. Amounts are never abbreviated (`₹5L`) in the product.
- Money direction is a word and a sign: `+ ₹2,000` received, `− ₹12,500` paid
  (true minus sign, U+2212). Never red for an ordinary expense.
- Dates: `15 Nov 2026`. Times: `7:12 pm` in the viewer's zone. Never ISO
  strings, never `11/15/2026`. All formatting goes through `src/lib/format`.
- People: display name as the person set it. Never a raw id or pseudonym.
- No exclamation marks. No "Welcome back", "Oops", "Awesome" or "successfully".
  State the fact: "Expense approved. 1 of 2".
- Every string lives in `src/i18n/messages` in English and Hindi in the same PR.
- A state shown on screen must be true. "Paid" means the bank debit matched.
  "Approved" means quorum reached. Never show a later state early.
- Anything simulated says "Simulated" where the viewer reads the result.

## 6. Banned

Any of these fails review:

- Gradients, glass blur, glows, neon, noise textures, decorative blobs.
- Shadows on cards. Cards inside cards. Coloured or tinted card backgrounds.
- Purple, blue or teal as brand colour. More than one accent hue.
- Emoji, stock illustration, 3D renders, generic "dashboard" hero screenshots.
- Rows of identical icon-plus-heading-plus-sentence feature cards.
- Centered body text. Text over images. Justified text.
- Pills used as decoration, badges on headings, chips that do nothing.
- Placeholder-only fields, disabled buttons with no explanation, dead links.
- Spinners for page loads, layout shift when data arrives.
- Raw ISO timestamps, UUIDs in visible text, `undefined`, `null`, `NaN`, `0.00`
  shown as a fact about missing data.
- Lorem ipsum, "John Doe", `test`, `foo`. Demo data uses believable Indian
  names, payees, amounts and dates.
- Toasts for errors the user must act on. Modals that open on page load.
- Inline `style` attributes. `!important`. Arbitrary Tailwind values.

## 7. Quality gates per screen

A screen is done when all of these hold, and the PR shows the evidence:

1. Screenshots in the PR at 390, 768 and 1440 px, in English and Hindi.
2. States built and tested: loading, empty, partial, full, error, and a long
   content case (40-character names, 9-digit amounts).
3. Keyboard: every action reachable, visible focus, logical order, `Esc`
   closes overlays and returns focus.
4. axe: zero violations. Lighthouse accessibility 100.
5. Public pages (`/`, `/funds/[id]`, `/verify`): Lighthouse performance 95 or
   more on mobile emulation, LCP under 2.0 s, CLS under 0.02, no more than
   170 KB of JavaScript transferred on first load.
6. Works at 200% text zoom and at 320 px width without horizontal scroll.
7. No console errors or warnings.
8. `pnpm verify` and `pnpm check:design` pass.

## 8. Enforcement

- `pnpm check:design` (added by YEN-99) scans `apps/web/src` for banned patterns (raw colours,
  palette classes, arbitrary values, inline styles, `dark:`, banned words) and
  fails CI. Existing violations are listed in a baseline file. The baseline
  only shrinks: a PR that adds an entry fails.
- `/design-system` shows every token and primitive. It is the reference
  render. A primitive that is not on that page does not exist.
- Reviewers reject on any rule in this file without further argument.
