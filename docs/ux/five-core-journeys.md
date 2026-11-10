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

## Journey 2: Donate via UPI and verify the receipt

Actor: donor, usually arriving from a shared link, never signs in.

Goal: pay the club's UPI, record the 12-digit UPI reference, and end with a receipt whose
verification link proves the donation is in the public record.

Route flow:

```
/funds/[fundId]           (public fund page, "Donate via UPI")
  -> /funds/[fundId]/donate
     -> receipt ("View receipt certificate")
        -> /receipts/[id]
           -> /verify?fundId=...&recordId=...   ("Check live verification record")
```

### J2-S1 Fund page, donation entry point

Route: `/funds/[fundId]`.

The donor sees the fund name, purpose, money summary and transparency timeline before donating
(the full page is specified as J5-S1).

- Primary action: `fund.donateCta` ("Donate via UPI"), prominent, links to
  `/funds/[fundId]/donate`.
- Secondary action: `fund.howDoIKnow` ("How do I know?"), opens the explainer dialog; it is a
  trust exit, not a competing next step.
- Empty state: if the fund has no records yet, the timeline section shows
  `fund.spendingEmpty` / empty filter copy rather than a blank region.
- Loading: the page is server rendered; the first paint is the page, not a skeleton.
- Error state: an unknown fund id renders the app not-found page; there is no fund-specific
  error copy to translate.
- Offline/slow network: when the record store cannot be reached, the page renders a saved copy
  with `fund.savedCopy` ("This is a saved copy from {time}. The fund records could not be
  refreshed just now.") in a status region. The donate CTA stays available; donations are
  pledges anyway (J2-S4).

### J2-S2 Choose amount

Route: `/funds/[fundId]/donate`, first view of the donation form.

- Primary action: none until an amount exists; the form advances within the same screen.
  The submit action of the whole form is "Record my donation" (J2-S4).
- Secondary action: none.
- Amount entry: preset rupee chips plus `donate.customAmountLabel` ("Another amount in rupees")
  with hint `donate.customAmountHint` ("Rupees and paise, for example 750.50").
- Error states: `donate.amountRequired`, `donate.amountInvalid`,
  `donate.amountTooLarge` ("Please enter an amount under Rs 10,00,000.") shown inline.
- Loading/offline: none on this view.

### J2-S3 Pay with the UPI app

Route: `/funds/[fundId]/donate`, second view of the same form.

Shows the club's UPI ID, a QR code labelled `donate.qrLabel` ("Scan to pay {upiId}") and an
`donate.openUpiApp` ("Open your UPI app") deep link on mobile.

- Primary action: open the UPI app or scan; both are presented, the deep link is the primary
  button, the QR is the fallback.
- Secondary action: none. The donor returns from the UPI app to this page with the reference
  number from their app (`donate.payBody` explains that the app shows a 12-digit reference).
- Empty/error/offline: not applicable; no network call in this view.

### J2-S4 Record the donation

Route: `/funds/[fundId]/donate`, third view of the same form.

- Primary action: `donate.submit` ("Record my donation"), replaced by `donate.submitting`
  ("Recording") while in flight.
- Secondary action: none. The UTR field is required (`donate.utrLabel` "12-digit UPI reference",
  hint `donate.utrHint`); donor name and receipt contact are optional and labelled as such
  (`donate.nameLabel`, `donate.contactLabel`).
- The screen states the honesty rule before submit: `donate.confirmBody` ("We match your
  reference against the club's bank statement. Until then the donation shows as waiting.").
- Error states: `donate.utrInvalid` for a malformed reference, `donate.contactInvalid` for a
  malformed contact, `donate.duplicateUtr` ("This UPI reference is already recorded.") when the
  same reference was claimed, and `donate.failure` for any other submission failure. Every
  error keeps the entered values.
- Loading: the submitting label is the only busy indicator; no route change until the pledge
  resolves.
- Offline: submission fails with `donate.failure`; retry is the same button.

### J2-S5 Donation recorded, waiting for the bank

Route: `/funds/[fundId]/donate`, success view.

- Primary action: `donate.viewReceipt` ("View receipt certificate"), links to
  `/receipts/[id]`.
- Secondary action: none.
- Copy: `donate.pendingTitle` ("Donation recorded, waiting for the bank") with
  `donate.pendingBody` ("We'll confirm this when the bank statement reflects it. Nothing is
  spendable before that."). This is the most important honesty sentence in the product: the
  money is not spendable until the bank match.

### J2-S6 Receipt certificate

Route: `/receipts/[id]`.

- Primary action: `receipt.verifyLink` ("Check live verification record"), links to
  `/verify?fundId=...&recordId=...` when the proof link is present.
- Secondary actions: `receipt.downloadPdf` / `receipt.downloadSvg`, and
  `receipt.backToFund` ("Back to fund overview"). Downloads are exits, not next steps.
- Statuses: pledged shows `receipt.statusPledged` ("Awaiting bank statement"); verified shows
  `receipt.statusVerified` ("Confirmed by bank") and the certificate title
  `receipt.verifiedTitle`. A refunded or rejected donation shows its own title
  (`receipt.refundedTitle`, `receipt.rejectedTitle`).
- Empty state: not applicable.
- Error state: an unknown receipt id renders the not-found page.
- Loading: server rendered, no skeleton.
- Tax note: the 80G notice (`receipt.taxNoticeTitle`, `receipt.taxNoticeBody`) is always
  visible on the certificate, in both languages
  (`receipt.taxNoticeBilingualSecondary` inlines the second language notice).

### J2-S7 Verification record check

Route: `/verify?fundId=...&recordId=...`.

The page auto-runs the check when a record id is present in the query, so the donor's only
action is reading the outcome. The manual path (typing an id) is specified in journey 5.

- Primary action: none while an outcome is displayed; reading is the task.
- Secondary action: `verify.backToFund` ("Back to fund").
- States are the four verification outcomes specified in J5-S3.

### Journey 2 record state machine

Donation record: `pledged -> verified` when the bank statement match lands; `pledged` stays
visible as awaiting with `receipt.statusPledged`; failure paths are `refunded` or `rejected`.
Nothing in this journey ever shows a donation as spendable before `verified`. The receipt
exists from the `pledged` stage onward.

## Journey 3: Treasurer files an expense request with a camera bill upload

Actor: treasurer on a phone, often standing in a shop with a paper bill.

Goal: end with a submitted expense request, bill photo attached, waiting for co-approver
review, with the spendable balance already showing the hold.

Route flow:

```
/funds/[fundId]/treasurer          (dashboard, "New Expense")
  -> /funds/[fundId]/expenses/new  (form, then camera, then review)
     -> back to /funds/[fundId]/treasurer (submitted, appears in pending list)
```

Note: `/funds/[fundId]/dashboard` renders the same treasurer page and is kept as a working
alias; the canonical route for all copy and tests is `/funds/[fundId]/treasurer`.

### J3-S1 Treasurer dashboard

Route: `/funds/[fundId]/treasurer`.

- Primary action: `treasurer.newExpenseCta` ("New Expense"), sticky full-width bar in the
  bottom thumb zone on phones (375 px), inline button on desktop.
- Secondary action: per pending expense, `treasurer.viewExpense` ("Review") linking to
  `/funds/[fundId]/approvals/[expenseId]` for the treasurer's own visibility; it is a list
  action, not the screen's next step.
- Content: `treasurer.totalBalance` and `treasurer.spendableBalance` cards. The spendable
  number is the one that matters before filing an expense; the difference between the two
  numbers is the sum of holds, which the expense timeline explains (J4-S2).
- Empty state: no pending expenses shows the `EmptyState` component with
  `treasurer.emptyTitle` ("No pending expenses"), `treasurer.emptyDescription` and the "New
  Expense" action inside the empty region as well, so the empty screen still has one obvious
  next action.
- Loading: `treasurer` shows a single status region with `common.loading` and
  `aria-busy="true"`. The full page is one skeleton, not per-card skeletons, because the
  dashboard is useless without the balance numbers.
- Error state: `treasurer.errorTitle` ("Could not load dashboard") with
  `treasurer.errorDescription` and a `treasurer.retry` button in an alert region.
- Offline: a persistent status banner `treasurer.offlineNotice` ("You are working offline.
  Displaying cached data.") with a retry button; the cached balances stay readable.

### J3-S2 New expense form

Route: `/funds/[fundId]/expenses/new`.

- Primary action: `expenseForm.reviewCta` ("Review expense"), advances to the review view of
  the same form.
- Secondary action: breadcrumb back to the treasurer dashboard labelled
  `treasurer.title` ("Treasurer dashboard") in a navigation landmark, plus
  `expenseForm.editCta` on the review view.
- Fields: amount (`expenseForm.amountLabel` "Amount (Rs)"), payee name, payee UPI VPA,
  purpose, optional receipt reference. Each has a hint in plain language
  (`expenseForm.payeeUpiHint` explains VPA with an example).
- Error states: per-field inline errors (`expenseForm.amountErrorRequired`, `...Invalid`,
  `...Positive`, `...Exceeds` with the spendable max interpolated, `expenseForm.payeeNameError`,
  `expenseForm.payeeUpiError`, `expenseForm.purposeError`). The exceeds error prevents
  submitting a request the fund cannot cover.
- Loading: the spendable balance hint appears once the dashboard data arrives; the form is
  usable before that, the hint simply fills in.
- Offline: submission fails; the form keeps values and shows a retryable failure.

### J3-S3 Camera bill capture

Route: `/funds/[fundId]/expenses/new` (evidence section of the form).

- Primary action: `evidence.cameraButton` ("Take photo"), opens the device camera via a file
  input with capture on mobile; `evidence.browseButton` ("Choose file") is the same control for
  gallery/PDF.
- Secondary action: none; removing a just-captured photo is an undo, shown as part of the
  selected-file row (`evidence.fileSelected`).
- Copy: `evidence.uploadTitle` ("Upload bill or receipt"),
  `evidence.uploadDescription` ("Attach a photo of the bill or a PDF document (up to 10 MB).").
- Empty state: `evidence.emptyHeading` ("No bill attached") with
  `evidence.emptyDescription` before anything is selected.
- Loading: `evidence.uploading` ("Uploading bill") with `evidence.uploadProgress`
  ("Uploading: {percent}%") on slow networks; the upload is the slowest step in the journey so
  the percentage matters.
- Error states: `evidence.errors.noFile`, `evidence.errors.fileTooLarge`,
  `evidence.errors.invalidType`, `evidence.errors.uploadFailed` (retry keeps the file). A
  duplicate document surfaces `evidence.duplicateWarning` as a warning, not a blocker; the same
  bill genuinely can be paid in two instalments.
- Offline: upload fails with `evidence.errors.uploadFailed`; the captured photo stays selected
  for retry.

### J3-S4 Review and submit

Route: `/funds/[fundId]/expenses/new` (review view).

- Primary action: `expenseForm.submitCta` ("Submit expense"), replaced by
  `expenseForm.submitting` ("Submitting...") while in flight.
- Secondary action: `expenseForm.editCta` ("Back to edit").
- Copy: `expenseForm.reviewTitle` ("Review expense request") and `expenseForm.reviewSummary`,
  which states the consequence: once submitted, approvers must verify with their PIN before
  release.
- Error state: submission failure returns to the review view with values intact and a
  retryable error.
- Loading: the submitting label only; no route change until the request resolves.

### J3-S5 Submitted confirmation

Route: `/funds/[fundId]/expenses/new` success state, then redirect to
`/funds/[fundId]/treasurer`.

- Primary action: on the dashboard, the just-submitted request sits at the top of the pending
  list with its `Review` link.
- Copy: `expenseForm.submitSuccess` ("Expense request submitted successfully").
- The pending list entry shows payee, purpose, amount and the `statusSubmitted` label
  ("Submitted"), so the treasurer can confirm without opening anything.

### Journey 3 record state machine

Expense record: `draft -> submitted -> hold_reserved -> (approved -> settled | rejected)`
with `hold_reserved` subtracted from spendable immediately at submission. The treasurer's
dashboard always reflects the hold from the moment the list shows "Submitted". Expiry before
quorum releases the hold (`expenseTimeline.stateExpired`, "Approval window closed before
quorum was met").

## Journey 4: Co-approver reviews a claim and authorizes release

Actor: co-approver, arriving from a WhatsApp deep link, often on a phone, often minutes after
the treasurer filed the request.

Goal: end with the co-approver's authorization recorded (or a reasoned rejection) without
ever seeing a technical word about signatures or cryptography.

Route flow:

```
WhatsApp message with /funds/[fundId]/approvals/[expenseId]
  -> J4-S1 request landing (read-only summary)
     -> J4-S2 authorize (PIN dialog, device-signed)
        -> J4-S4 outcome (toast + settled timeline)
     or -> J4-S3 reject (reason dialog)
        -> J4-S4 outcome
```

### J4-S1 Request landing

Route: `/funds/[fundId]/approvals/[expenseId]`.

- Content: amount as the largest element, payee, payee UPI VPA, purpose, requester and time,
  receipts (`approver.receipts` "Receipts & evidence" or `approver.noReceipts`), and the
  `ExpenseTimeline` ("Request progress") that shows how many of the required approvals have
  landed so far.
- Primary action: `approver.approveCta` ("Approve"), in a sticky bottom action bar on phones
  next to the danger action.
- Secondary action: `approver.rejectCta` ("Reject"), same bar. Both are visible together; a
  reviewer must be able to say no as easily as yes.
- The header notice `approver.fastDecisionNotice` ("Fast decision: Review details and approve
  or reject below.") tells the reviewer the two actions are the whole task.
- Empty state: not applicable; the deep link always targets one expense.
- Loading: status region with `common.loading` and `aria-busy="true"` while the expense is
  fetched.
- Error state: alert region with the failure text and a retry button; "Expense not found" for
  a dead or wrong link, plus the breadcrumb back to the treasurer dashboard.
- Offline: status banner `treasurer.offlineNotice` with retry; the summary stays readable from
  the initial fetch.

### J4-S2 Authorize (approval PIN dialog, device-signed)

Route: same, dialog over the request.

- Primary action: `approver.pinSubmit` ("Confirm approval"), replaced by
  `approver.pinSubmitting` ("Approving...").
- Secondary action: `approver.cancel` ("Cancel"), which returns to the request unchanged.
- Dialog title: `approver.pinModalTitle` ("Enter 6-digit approval PIN"). Description:
  `approver.pinModalDescription` ("Your PIN signs the cryptographic approval for this expense
  release."). Note for reviewers of this spec: this sentence is the last place the word
  "cryptographic" appears; it is scheduled for replacement by a plain-language sentence in a
  copy pass, tracked with the usability findings (task T4).
- Device binding: the PIN alone never authorizes a new device. New devices confirm by OTP, and
  on supporting devices the approval action is additionally signed by a WebAuthn passkey
  credential bound to the action (see `docs/REFERENCES.md`, WebAuthn section: Yen uses WebAuthn
  as an optional device-signing factor on top of the PIN, with the challenge tied to the action
  hash). Users experience this as "your phone confirms it is really you"; no copy mentions the
  protocol by name.
- Error states: `approver.pinError` (format), `approver.pinIncorrectAttemptsRemaining`
  (counts down remaining attempts), `approver.pinLockoutNotice` (30 minute temporary lock),
  `approver.pinPermanentLockoutNotice` (admin reset required),
  `approver.pinCoolingOffNotice` (24 hour cooling-off after a PIN reset). Lockouts are shown
  inside the dialog, never as toasts that vanish.
- Loading: the submitting label; the dialog blocks double submission.

### J4-S3 Reject with reason

Route: same, dialog over the request.

- Primary action: `approver.rejectSubmit` ("Confirm rejection").
- Secondary action: `approver.cancel`.
- Copy: `approver.rejectModalTitle` plus `approver.rejectModalDescription` ("A rejection reason
  is mandatory and will be recorded in the audit log."). The reason field enforces
  `approver.rejectReasonError` ("Reason is required (at least 5 characters)").
- The rejection reason becomes part of the public record (journey 5 timeline), which is why it
  is mandatory and free-text.

### J4-S4 Outcome

Route: same, after the dialog closes.

- Success toast: `approver.approvedSuccess` ("Expense successfully approved") with payee and
  purpose; rejection toast: `approver.rejectedSuccess` with the recorded reason.
- The timeline updates in place to `stateApprovals` ("Approvals ({approved} of {quorum})"),
  `stateSettled` ("Settled & paid") or `stateRejected`.
- Already-decided deep links (a second approver opening a settled request) show
  `approver.alreadyApproved` / `approver.alreadyRejected` as a status banner instead of the
  action bar; there is nothing to do and the screen says so.
- The quorum outcome (second and final approval) is what releases the hold; the treasurer
  sees the balance change on the dashboard without any action.

### Journey 4 record state machine

Approval count on the expense: `0 -> 1 -> quorum(2)`. Each authorization is
`pin_prompt -> verifying -> recorded` or blocked by
`format_error | attempts_remaining | temporary_lockout | permanent_lockout | cooling_off`.
Expense-level: `submitted -> hold_reserved -> approved -> settled`, or
`hold_reserved -> rejected` (reason recorded), or expiry releasing the hold. A settled or
rejected expense is terminal and its deep link renders the already-decided banner.

## Journey 5: Public transparency inspection and verification link check

Actor: any visitor with a link: a donor who gave money, a member who wants to check, a
journalist or an auditor. No account, no sign-in, no payment.

Goal: end with the visitor able to answer "did the money go where they said?" and, for a
specific record, "has this record been changed since it was written?"

Route flow:

```
shared link -> /funds/[fundId]
  -> timeline entry -> /verify?fundId=...&recordId=...   ("Check this record")
  -> explainer dialog  ("How do I know?")
  -> (optionally) any receipt -> /receipts/[id] -> /verify
```

### J5-S1 Public fund overview

Route: `/funds/[fundId]`.

- Content: fund name and purpose, org badge (`fund.orgBadge` "Registered group"), money
  summary (`fund.totalRaised`, `fund.totalSpent`, `fund.currentBalance` with Indian digit
  grouping), spending by category with plain names (`fund.categoryEquipment` "Equipment &
  Hardware" and so on), and the live transparency timeline
  (`fund.timelineTitle` "Live transparency timeline",
  `fund.timelineDescription` "Every donation and expense confirmed by the community.").
- Primary action: reading is the task; the donate CTA (`fund.donateCta`) is the screen's single
  forward action for donors (journey 2 entry).
- Secondary actions: timeline filters (`fund.filterAll`, `fund.filterDonations`,
  `fund.filterExpenses`) and per-entry exits (`fund.viewEvidence` "View bill or receipt",
  `fund.checkRecord` "Check this record").
- Trust explainer: `fund.howDoIKnow` ("How do I know?") opens a dialog with four numbered
  proofs (`fund.bankVerificationTitle`, `fund.approvalsTitle`, `fund.evidenceTitle`,
  `fund.tamperProofTitle`). The tamper-evident proof is written as "Each entry is sealed in the
  public account book so past records cannot be altered or deleted." No protocol names.
- Empty state: no spending yet shows `fund.spendingEmpty` ("No spending recorded yet."); an
  empty filter result shows `fund.emptyFilter` ("No records match this filter.").
- Loading: server rendered.
- Error state: unknown fund renders not-found.
- Offline/slow network: saved copy banner `fund.savedCopy` in a status region (see J2-S1).
  The page is cached and ETagged precisely so this banner is rare.

### J5-S2 Verification link check

Route: `/verify?fundId=...&recordId=...` (arriving from a timeline entry or a receipt).

- Primary action: none; the check runs automatically on arrival and the visitor reads the
  outcome. The page must never require the visitor to press a button to start a check it could
  run itself.
- Secondary action: `verify.backToFund` ("Back to fund").
- Idle state (no record id in the query, manual path): the form with
  `verify.enterRecordIdLabel` ("Record identifier"), optional `verify.fundIdLabel`, and the
  `verify.verifyButton` ("Check record") as the primary action; below it the audit bundle
  upload (`verify.uploadBundlePrompt`, `verify.dropBundleHere`) for auditors with an exported
  bundle.

### J5-S3 Verification outcomes

Route: `/verify`, result region after a check.

Four outcomes, each leading with the plain-language meaning, with technical inspection folded
away by default:

- Verified: `verify.outcomeVerified` ("Verified") with `verify.passHeadline` ("This record was
  written on {date} and has not been changed since"). Green, with a check mark; never the only
  signal, the word is the signal.
- Pending: `verify.outcomePending` ("Pending seal") with `verify.pendingHeadline` ("Sealed in
  account book; awaiting next scheduled public seal"). Honest about the delay, never worded as
  a failure.
- Skipped: `verify.outcomeSkipped` ("Unverified / Registry skipped") for records whose public
  registry seal was not run; the visitor is told the in-browser proof still holds
  (`verify.offlineNotice` covers the server-independence of the check).
- Failed: `verify.outcomeFailed` ("Verification failed") with `verify.failHeadline`
  ("Verification failed: record was altered or invalid") in the destructive style. This is the
  screen that catches tampering; it must be unmistakable.
- For skeptics and auditors only: the collapsed details disclosure
  `verify.technicalInspectionTitle` ("Technical details (for skeptics and auditors)") exposes
  fingerprints, seal roots and registry references. This is the one sanctioned place where
  technical terms appear, deliberately folded away from the main flow.
- Loading: `verify.checking` ("Checking record proof...") in a status region with a spinner.
- Error state: `verify.outcomeFailed` region with the failure message (record not found,
  network error); the form keeps the entered identifiers for retry.
- Offline: the same failed region; verification of an uploaded bundle still works fully offline
  because the checks run in the browser, which the page states in `verify.offlineNotice`.

### J5-S4 Audit bundle exports

Route: `/verify`, export bar.

- Actions: `verify.downloadVerifierScript` ("Download offline verifier script"),
  `verify.downloadBundleJson`, `verify.downloadBundleCsv`. These exist so an auditor can check
  the whole fund without network access or trust in this website.
- These are auditor exits from the main visitor flow; they are visually secondary to the
  record check form and never appear before an outcome exists.

### Journey 5 record state machine

Verification outcome for one record:
`idle -> checking -> verified | pending | skipped | failed`, plus the manual-path
`idle` when no record is given. Nothing in this journey mutates anything: it is read-only by
design, which is also why it must work signed-out, offline-first and from a saved copy.

### Cross-journey state vocabulary

| Concept | States | Where shown |
| --- | --- | --- |
| Donation | pledged, verified, refunded, rejected | receipt, fund timeline |
| Expense | draft, submitted, hold_reserved, approved, settled, rejected, expired | treasurer list, approval timeline |
| Approval count | 0 to quorum (2 of 3 default) | expense timeline |
| Verification outcome | verified, pending, skipped, failed | verify page, badges |
| Connectivity | online, offline (cached copy), slow (progress) | banners and status regions |

Every status string pairs a word with a distinct shape or icon; colour alone is never the
signal (`designSystem.statusBody`).
