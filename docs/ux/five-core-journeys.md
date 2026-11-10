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

## Journey 1: Create a fund and nominate co-approvers

Actor: treasurer, often setting this up on a phone at a club meeting.

Goal: end the session with a fund that accepts UPI donations and has at least two confirmed
co-approvers who each received a WhatsApp invite.

Route flow:

```
/onboarding (step 1 to 5, one wizard, draft saved on device)
  -> done screen (still /onboarding, "Your fund is ready")
     -> share invite links on WhatsApp (outside the app)
/invites/accept?code=... (each co-approver, on their own phone)
```

### J1-S1 Club details

Route: `/onboarding`, step 1 of 5.

The screen shows the wizard title, a progress indicator announced as "Onboarding progress"
with the current step spoken as "Step 1 of 5: Club", and two fields.

- Primary action: `onboarding.continue` ("Continue"), full width in the thumb zone, disabled
  appearance is never used for validation; tapping it with empty fields shows the inline error.
- Secondary action: none on step 1. The draft is saved on the device automatically
  (`onboarding.intro` says so), so there is no save action and no cancel that could lose work.
- Empty state: not applicable; the wizard always starts at step 1 with blank fields unless a
  saved draft exists, in which case the saved values are restored and the wizard reopens on the
  saved step.
- Loading: no network call on this step, so no skeleton. The only busy state is the final
  create action on step 5.
- Error state: `onboarding.errors.club` inline under the missing field ("Enter a club name."),
  announced politely. The club type radio group shows the same pattern.
- Offline: creating the fund is the only network step. Offline is surfaced there (J1-S5), not
  here.

### J1-S2 Fund details

Route: `/onboarding`, step 2 of 5.

Fields: purpose (required), description (optional), target amount.

- Primary action: "Continue".
- Secondary action: `onboarding.back` ("Back"), text button beside the primary action, always
  available from step 2 onward.
- Amount entry rule: the target is entered in whole paise with the hint
  `onboarding.fund.targetHint` ("For example, 125000 for Rs 1,250.00. No decimals."). This is a
  known plain-language risk: pilot users are expected to misread paise as rupees. The usability
  protocol (see `usability-interview-protocol.md`, task T4) tests this field unaided; if more
  than 2 of 5 pilot participants hesitate, file a follow-up to accept rupees with automatic
  conversion.
- Error state: `onboarding.errors.fund` on missing purpose or malformed target.
- Loading and offline: none on this step.

### J1-S3 Payment details

Route: `/onboarding`, step 3 of 5.

Fields: UPI VPA, bank account or UPI payee name.

- Primary action: "Continue". Secondary action: "Back".
- Plain-language guard: "UPI VPA" is the one term this journey cannot avoid because it is
  printed on the club's bank paperwork. The hint must always give an example
  (`onboarding.payment.vpa` keeps the example as a shared string across locales).
- Error state: `onboarding.errors.payment` when either field fails format checks.
- Loading and offline: none on this step.

### J1-S4 Approvers

Route: `/onboarding`, step 4 of 5.

Fields: approver 1 name and phone, approver 2 name and phone, optional third approver
("Add third approver").

- Primary action: "Continue". Secondary action: "Back".
- The screen states the rule in one line: two approvals are required, the third person is
  optional (`onboarding.approvers.hint`). This is the screen that encodes the 2-of-3 quorum,
  so the copy must never say "optional approvers" without the required count.
- Empty state: not applicable.
- Error state: `onboarding.errors.approvers` when fewer than two complete contacts, and
  `onboarding.errors.approverPhone` per field for a malformed number.
- Loading and offline: none on this step. Invite creation failures surface on the done screen.

### J1-S5 Visibility and create

Route: `/onboarding`, step 5 of 5.

Radio group: Public / Donors only / Members only, each with a one-line consequence
(`onboarding.visibility.*`).

- Primary action: `onboarding.create` ("Create fund"), full width, replaced by
  `onboarding.creating` ("Creating...") while the request is in flight. This is the only busy
  state in the journey; the button stays disabled for the duration and no other control can
  trigger a second request.
- Secondary action: "Back" is still available before the request starts; once it is in flight
  the wizard blocks navigation to avoid a half-created fund.
- Loading: the creating label is the skeleton. No separate spinner screen.
- Error state: `onboarding.errors.createFailed` in an alert region with the "Create fund"
  button re-enabled for retry. Draft data is never cleared on failure.
- Offline: same failure copy covers offline; the retry succeeds once connectivity returns.

### J1-S6 Fund ready, share invites

Route: `/onboarding` (done step, same URL).

Success screen: `onboarding.done.title` ("Your fund is ready") as an h1, body
`onboarding.done.body` explaining that invites complete the 2-of-3 setup.

- Primary action: `onboarding.done.share` ("Share approver invite {index} on WhatsApp"), one
  button per nominated approver, each opening a prefilled WhatsApp message with the invite link
  that points to `/invites/accept?code=...`.
- Secondary action: `onboarding.done.open` ("Open fund"), link to the public fund page
  `/funds/[fundId]`.
- Empty state: not applicable; at least two invite buttons always exist.
- Loading: none; invites are created together with the fund.
- Error state: per-invite failure shows `onboarding.errors.inviteFailed` next to the failed
  share button; the other buttons stay usable. Retry regenerates only the failed invite.

### J1-S7 Co-approver accepts invite

Route: `/invites/accept?code=...`.

The co-approver lands here from WhatsApp. The screen must work before any sign-in.

- Primary action: `invite.submit` ("Accept invite"), submitting name plus the phone number the
  invite was sent to (`invite.intro`).
- Secondary action: none. If the code is missing the form is replaced by
  `invite.missingCode` ("This invite link is incomplete."), the only content on screen; there
  is nothing to retry without a new link.
- Empty state: the missing-code case above is the empty state for this route.
- Loading: none on mount; submission shows the submitting state of the accept button.
- Error state: `invite.invalid` ("This invite is invalid or has expired.") in an alert region.
  A pending nomination shows `invite.pending`; a confirmed one shows `invite.approved`
  ("You are now an approver.") and the journey ends.
- Offline: submit fails with the same alert copy and the form keeps its values.

### Journey 1 record state machine

The fund record moves `none -> created`. Each nomination moves
`invited -> pending -> accepted` (or stays `invalid/expired` and can be re-shared from the
done screen). The fund becomes donation-capable immediately after creation; the 2-of-3 quorum
only gates expenses (journey 4), not donations.
