# Five Core Journeys: screen specs for non-technical users

Status: draft for pilot review (YEN-9, issue 80)

Audience: designers, frontend engineers, usability researchers and pilot coordinators.

Treasurers and donors are often non-technical. Every screen in this document is written for
someone who has never heard of a blockchain, a hash function or a wallet. If a screen needs a
technical word to make sense, the screen is wrong.

## Design principles

1. One next action per screen. Each screen names exactly one primary action. Secondary actions
   are allowed only when they are exits (back, cancel, dismiss), never competing next steps.
2. Large tap targets. Buttons and inputs are at least 48 px tall at the 375 px mobile viewport.
   The primary action sits in the lower thumb zone on phones.
3. Plain language. User-facing copy never says "hash", "block", "merkle", "ledger", "on-chain"
   or "wallet". Say "verification code", "receipt", "proof", "record", "account book" instead.
   The automated jargon check in `apps/web/src/i18n/messages.test.ts` enforces this for shipped
   copy; this document applies the same rule to every string quoted below.
4. Bilingual parity. Every quoted string exists in both English and Hindi with the same
   message key, the same interpolation placeholders and the same meaning. Copy tables at the
   end of this document list the exact keys from `apps/web/src/i18n/messages/en.ts` and
   `apps/web/src/i18n/messages/hi.ts`.
5. Honest states. No screen hides waiting, failure or lost connectivity. Every async screen
   specifies its loading, empty, error and offline states, and every promise about money is
   written as the app writes it: Yen never holds the money.

## Conventions

- Viewport: all screens are specified at 375 px width (iPhone SE class, the smallest supported
  phone). Layout notes call out anything that only works at larger widths.
- Screen ids use the form `J1-S2` (journey 1, screen 2) and are stable identifiers meant to be
  quoted in issues, usability findings and test names.
- Roles named per screen (primary action, secondary action) refer to the visual and semantic
  role, not to HTML roles. Landmark roles (main, navigation, form, dialog, status, alert) are
  quoted with their ARIA names because the route test asserts them.
- Route paths reference the actual Next.js app router files under `apps/web/src/app`. The
  automated route test in `apps/web/src/test/core-journey-routes.test.ts` renders these pages
  and asserts the landmarks and links listed here.
- State notation: `idle -> busy -> outcome`, where outcome is one of `success`, `empty`,
  `error`, `offline`. Every busy state is interruptible by the back control.

## Core route map

These are the only routes the five journeys use. All of them exist in the app router today.

| Route | Page file | Journeys | Landmarks asserted |
| --- | --- | --- | --- |
| `/onboarding` | `app/onboarding/page.tsx` | 1 | main, form |
| `/invites/accept` | `app/invites/accept/page.tsx` | 1 | main, form |
| `/funds/[fundId]` | `app/funds/[fundId]/page.tsx` | 2, 5 | main, article |
| `/funds/[fundId]/donate` | `app/funds/[fundId]/donate/page.tsx` | 2 | main, form |
| `/receipts/[id]` | `app/receipts/[id]/page.tsx` | 2 | main |
| `/verify` | `app/verify/page.tsx` | 2, 5 | main, form |
| `/funds/[fundId]/treasurer` | `app/funds/[fundId]/treasurer/page.tsx` | 3 | main |
| `/funds/[fundId]/dashboard` | `app/funds/[fundId]/dashboard/page.tsx` | 3 | main (alias of treasurer) |
| `/funds/[fundId]/expenses/new` | `app/funds/[fundId]/expenses/new/page.tsx` | 3 | main, form |
| `/funds/[fundId]/approvals/[expenseId]` | `app/funds/[fundId]/approvals/[expenseId]/page.tsx` | 4 | main, navigation |
| `/` | `app/page.tsx` | 5 | main (pilot landing) |
| `/privacy` | `app/privacy/page.tsx` | 5 | main (linked from receipts) |

Journey coverage summary:

| Journey | Entry route | Exit route | Actor |
| --- | --- | --- | --- |
| 1. Create fund and nominate co-approvers | `/onboarding` | `/onboarding` (done step) | Treasurer |
| 2. Donate via UPI and verify receipt | `/funds/[fundId]` | `/verify?fundId=...&recordId=...` | Donor |
| 3. Treasurer files expense request | `/funds/[fundId]/treasurer` | `/funds/[fundId]/treasurer` | Treasurer |
| 4. Co-approver reviews claim and authorizes | `/funds/[fundId]/approvals/[expenseId]` | same route (settled state) | Co-approver |
| 5. Public transparency inspection | `/funds/[fundId]` | `/verify?fundId=...&recordId=...` | Any visitor |

Each journey section below gives: the route flow, screen-by-screen specs (primary action,
secondary action, states) and the state machine for the money record the journey creates.
Bilingual copy tables follow in a dedicated section.
