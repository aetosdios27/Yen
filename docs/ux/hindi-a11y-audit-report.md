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
