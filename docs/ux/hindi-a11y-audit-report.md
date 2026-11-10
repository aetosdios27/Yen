# Hindi localization and accessibility audit of core flows (YEN-45)

Status: audit report for the core money flows. The onboarding and invite
redemption portion of YEN-45 was audited earlier (PR #136); this increment
covers the flows a club member walks through after onboarding.

Every claim below is backed by an automated test that ran green at the time of
writing, or by direct source inspection that is named as such. Where jsdom
cannot measure something, the limitation is stated instead of glossed over.

## Scope

Core flows audited in both English and Hindi, keyed to the journeys in
`docs/ux/five-core-journeys.md`:

| Flow | Route | Journeys |
| --- | --- | --- |
| Public fund view (header, money summary, spending by category, spend timeline, explainer modal) | `/funds/[fundId]` | 2, 5 |
| Donate (amount, UPI payment, confirm reference, receipt certificate) | `/funds/[fundId]/donate`, `/receipts/[id]` | 2 |
| Public verification explainer (record check, audit bundle, technical inspection) | `/verify` | 2, 5 |
| Treasurer dashboard (balances, pending requests) | `/funds/[fundId]/dashboard` | 3 |
| New expense (form with validation) | `/funds/[fundId]/expenses/new` | 3 |
| Approval inbox (expense timeline, approval PIN modal, rejection modal) | `/funds/[fundId]/approvals/[expenseId]` | 4 |

Two supporting layers were audited alongside the screens:

- Indian formatting standards: rupee symbol with lakh/crore digit grouping and
  locale-aware dates.
- Notification copy. WhatsApp, SMS and email strings do not live in the web
  i18n layer; they live in `packages/notifications/src/templates.ts` with
  per-template English and Hindi branches and channel schemas that require
  both languages (`packages/notifications/src/channels/`). Parity there is
  guarded in that package rather than in `apps/web`.

## Method and tooling

Test stack: vitest, jsdom, @testing-library/react, axe-core via vitest-axe.

Known jsdom constraints, stated once and honoured everywhere below:

1. jsdom performs no layout and computes no CSS cascade. It therefore cannot
   measure pixel overflow, text clipping, colour contrast or element sizes.
2. Where a check needs those facts, the tests derive them from what jsdom
   does have: the class list and inline styles of every node in the rendered
   DOM, the Tailwind spacing scale (1 unit = 0.25rem = 4px), and the design
   token definitions in `apps/web/src/styles/tokens.css` and
   `apps/web/src/app/globals.css`.
3. Colour contrast is computed arithmetically over every token pair in
   `apps/web/src/styles/tokens.test.ts`; axe's `color-contrast` rule is
   disabled in the test helper because jsdom cannot compute it.

Guards that existed before this increment and were extended rather than
replaced:

- `apps/web/src/i18n/messages.test.ts`: catalogue parity (same key tree in
  `en`, `hi` and `en-XA`, no empty strings, placeholder parity, pseudo-locale
  expansion, plain-language jargon ban).
- `apps/web/src/app/mobile-360.guard.test.ts`: static scan of every component
  file for fixed widths above 360 px and `whitespace-nowrap`.
- `apps/web/src/test/a11y.tsx`: axe pass helper used by every a11y suite.

## What the audit checked and what passed

### Hindi catalogue completeness

`apps/web/src/i18n/messages/hi.ts` is typed as `Messages` (derived from the
English catalogue), so a missing key fails typecheck before any runtime test
runs. `apps/web/src/i18n/messages.test.ts` adds on top of that:

- exact key-tree parity across `en`, `hi` and `en-XA` at runtime;
- no empty strings in any locale;
- no value in `hi` equal to its English counterpart, except the nine
  intentional brand names, autonyms and placeholders listed in
  `IDENTICAL_BY_DESIGN`;
- interpolation placeholder parity in Hindi and pseudo-locale;
- a section-presence test for the core flow areas: spend timeline states,
  spending categories, approver inbox, approval PIN modal, rejection errors,
  verification outcomes, donation errors, evidence upload and status labels.

New in this increment:

- an English leak guard that strips `{placeholders}`, email examples and
  alphanumeric codes, then asserts the only Latin words left in Hindi copy are
  an explicit allowlist of acronyms and brands (UPI, VPA, JSON, CSV, API, PDF,
  PNG, JPEG, WebP, SVG, SMS, UTR, MB, OTP, PIN, QR, ID, INV, DPDP, px, Yen,
  YEN, WhatsApp, GitHub, iPhone, email). The sweep found one legitimate
  acronym to allowlist (DPDP, the Digital Personal Data Protection Act) and no
  untranslated English.
- `apps/web/src/app/verify/page.test.tsx` renders a full verified result in
  Hindi and asserts the outcome chip, result labels, seal status and headline
  come out in Devanagari.

### WCAG 2.2 AA mapping with evidence

| Success criterion | How it was checked | Result |
| --- | --- | --- |
| 1.1.1 Non-text content | axe runs on every core component; icons render `aria-hidden="true"` (inspection of `components/icons.tsx` and `components/fund/icons.tsx`) | Pass |
| 1.3.1 Info and relationships | axe on all core screens; landmark assertions in `src/test/core-journey-routes.test.ts` and `components/semantics.test.tsx` | Pass |
| 1.4.3 Contrast (minimum) | arithmetic contrast checks over every token pair in `src/styles/tokens.test.ts` (jsdom cannot compute rendered contrast) | Pass at token level |
| 1.4.4 Resize text | type scale is rem-based in `tokens.css`; the one fixed px text size found (`text-[11px]` on the verify technical panel) was replaced with `0.6875rem`; the rendered zoom guard in `src/app/hindi-360-layout.test.tsx` fails on any `text-[Npx]` in the core screens | Pass after fix |
| 1.4.10 Reflow | static 360 px guard plus a new rendered guard over five core screens (fund view, donate, approvals with PIN modal, treasurer dashboard, verify) in Hindi: no width above 360 px, no `whitespace-nowrap` or `truncate` on Devanagari text | Pass after fix |
| 1.4.11 Non-text contrast | token pairs checked in `tokens.test.ts`, including borders and status colours | Pass at token level |
| 2.1.1 / 2.1.2 Keyboard | `components/keyboard.test.tsx` (Tab reaches controls, Enter and Space activate, Escape dismisses toast), `dashboards.a11y.test.tsx` (form tab order, Escape closes the PIN modal) | Pass |
| 2.4.7 Focus visible | `:focus-visible` outline token in `app/globals.css` with the 3:1 focus colour in `tokens.css` (inspection) | Pass |
| 2.5.8 Target size (minimum) | every Button, Input and primary link carries the `tap-target` class; `hindi-360-layout.test.tsx` proves the class resolves to `var(--spacing-tap)` = 3rem = 48 px and that every rendered primary or danger action in the five screens carries it | Pass |
| 3.1.1 / 3.1.2 Language of parts | `LocaleProvider` sets `document.documentElement.lang` on every locale change and syncs `<title>` and meta description (inspection of `i18n/locale-provider.tsx`); Hindi strings are pure Devanagari plus the allowlisted acronyms | Pass |
| 3.3.1 / 3.3.3 Error identification and suggestion | donation, expense form and PIN validation errors come from the catalogue and render in the active locale; axe passes with validation errors visible (`donation.a11y.test.tsx`, `dashboards.a11y.test.tsx`) | Pass |
| 4.1.2 Name, role, value | axe on all core screens in both languages | Pass |

### Component and screen axe coverage (both languages)

Evidence files: `components/fund/fund.a11y.test.tsx` (12 tests: FundHeader,
MoneySummary, SpendingBreakdown, FundTimeline, HowDoIKnowModal, integrated
PublicFundView), `components/donation.a11y.test.tsx`, `components/receipt.a11y.test.tsx`,
`components/dashboards.a11y.test.tsx` (12 tests including ExpenseTimeline,
ExpenseForm, ApprovalPinModal, RejectionModal and the treasurer dashboard),
`components/onboarding.a11y.test.tsx`, `app/verify/verify.a11y.test.tsx`,
`app/pages.a11y.test.tsx`. All green in English and Hindi.

## Formatting standards

`apps/web/src/lib/format.ts` provides locale-aware formatters used across the
core screens:

- `formatMoney(amountPaise, locale)`: rupee symbol with lakh/crore grouping.
  Rupees and paise are split before formatting, so no float is ever formatted.
  Both `en-IN` and `hi-IN` use the Indian digit system; the tests pin that
  equality rather than assume it.
- `formatDate` / `formatDateTime`: `en-IN` gives `28 Oct 2026`; `hi-IN` gives
  `28 अक्तू॰ 2026` with Devanagari month names.

Call sites wired to the active locale: the `Money` component (fund view,
donation, receipt, dashboard, approvals), the fund spend timeline, the receipt
certificate, and the verify result panel. Previously the receipt, the fund
timeline and the verifier hardcoded `en-IN` regardless of locale.

Boundary cases pinned in `src/lib/format.test.ts` and `money.test.tsx`:

| Paise | Rendered |
| --- | --- |
| 0 | ₹0.00 |
| 9950 | ₹99.50 |
| 10000000 | ₹1,00,000.00 |
| 123456700 | ₹12,34,567.00 |
| 1000000000 | ₹1,00,00,000.00 |
| 100000000000 | ₹1,00,00,00,000.00 |
| 999999999999 | ₹9,99,99,99,999.99 |
| -5050 | -₹50.50 |

No rendering ever produces a floating-point exponent; the tests assert it.

## Issues found and fixed

1. The verify result panel leaked English in Hindi mode: the outcome headline
   and detail line were built inside `lib/verifier.ts` in English; the
   summary labels ("Amount", "Date recorded", "Seal verification"), the seal
   status values, "Raw Event Record", the audit bundle headline ("Audit Bundle
   Verified: n record(s) intact"), the per-check Pass/Fail markers and the
   exports heading were hardcoded. Fixed by adding 27 keys per locale to the
   `verify` section, adding a structured `detailKind` to the verification
   report so the page maps outcomes to message keys, and rendering a full
   Hindi result in `page.test.tsx`.
2. `text-[11px]` fixed pixel text on the verify technical inspection panel did
   not scale with browser zoom (1.4.4). Replaced with `0.6875rem` everywhere.
3. The treasurer dashboard ellipsized the expense purpose with `truncate`,
   clipping longer Hindi purposes to one line (1.4.10). The rendered 360 px
   guard caught it; the purpose now wraps.
4. The three verify export buttons (script, bundle JSON, bundle CSV) rendered
   around 40 px tall, below the project's own 48 px control standard from
   `docs/ux/five-core-journeys.md`. They now carry the `tap-target` class.
5. Receipt, fund timeline and verifier dates ignored the locale; Money output
   was locale-independent. Both now flow through the shared formatters.

## Justified exceptions and honest limitations

- Pixel truth: jsdom does no layout, so the overflow, zoom and tap-size checks
  derive sizes from class names, inline styles and token definitions rather
  than from measured boxes. They prove structural reflow safety, not rendered
  geometry. Playwright e2e (`apps/web/e2e/core-journey.spec.ts`) drives real
  browsers and complements this, but it does not assert 360 px geometry today.
- Contrast: computed over design tokens, not over rendered elements. Any
  future colour used outside the tokens is unverified.
- Dynamic user data: fund names, expense purposes and payee names are
  user-authored and render exactly as submitted; the app does not translate
  user content.
- The raw event JSON block in the verify technical inspection panel is
  intentionally untranslated technical data; every label around it is
  localized.
- Audit bundle check names come from `@yen/shared` in English. The eight known
  names ("bundle format", "canonical event hash(es)", "hash chain",
  "Merkle inclusion (proofs)", "batch ranges and roots", "anchor reference")
  map to catalogue keys; an unknown future name falls back to the English
  string, which the Hindi leak guard does not cover because it is data, not
  catalogue copy.
- `en-XA` (pseudo-locale) formats money and dates as `en-IN` by design; it is
  a layout stress locale, not a translation.
- The 27 new verify keys and their Hindi render test cover the record result
  and bundle result states rendered by the page. The pending state's dynamic
  API message (`pendingWindow.message`) is no longer rendered; the page shows
  the localized `verify.pendingDetail` instead, so no English sentence from
  the API reaches Hindi users.

## Evidence index

New or extended in this increment:

- `apps/web/src/i18n/messages.test.ts` (9 tests)
- `apps/web/src/lib/format.test.ts` (16 tests)
- `apps/web/src/app/hindi-360-layout.test.tsx` (6 tests)
- `apps/web/src/app/verify/page.test.tsx` (9 tests, one new Hindi render)
- `apps/web/src/components/dashboards.a11y.test.tsx` (12 tests)
- `apps/web/src/components/money.test.tsx`
- `packages/notifications/src/templates.test.ts` (10 tests, new parity sweep)

Full web suite at audit time: 59 test files, 382 tests, all passing.

