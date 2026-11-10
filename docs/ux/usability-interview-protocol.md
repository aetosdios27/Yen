# Usability interview protocol: unaided testing with non-technical users

Status: ready for pilot trials (YEN-9, issue 80)

Audience: usability session facilitators and observers working with treasurers, co-approvers
and donors who have no technical background.

Companion documents: `docs/ux/five-core-journeys.md` (the screens under test) and the findings
log template in the second half of this file.

## Why unaided

Yen's promise is that a non-technical person can move money through a club transparently. That
promise is only true if a first-time user succeeds without a helper, a manual or a hint. So the
protocol is deliberately unaided:

- The facilitator never explains how a screen works before the participant tries it.
- Questions asked mid-task get one answer only: "Please try it the way you would at home."
- If the participant is stuck for a defined time (see abandonment rules), the task ends and the
  stuck point is recorded. Being stuck is a finding, not a failure of the participant.

## Session setup

- Length: 45 minutes per participant (30 minutes of tasks, 15 minutes of debrief).
- Device: the participant's own phone where possible, otherwise a test phone at 375 px width.
  Sessions on desktop are recorded separately and are not comparable.
- Language: run the session in the participant's preferred language (English or Hindi). Note the
  language at the top of the findings log; a screen that works in English but fails in Hindi is
  a parity finding.
- Network: at least one task per participant is run on a throttled connection (slow 3G class)
  and one offline, because the journeys promise clear slow-network and offline states.
- Recording: screen recording plus audio, with verbal consent. One facilitator runs the session,
  one observer takes findings notes live.
- Compensation and privacy: follow the pilot's consent process. Never capture real phone
  numbers, real bank details or real UPI references during tasks; participants use the sandbox
  environment with fictional data.

## Facilitator script

Opening (read verbatim):

"I am testing a new tool for community clubs called Yen. I did not build it and I want to know
whether real people can use it without help. There are no right or wrong answers, and nothing
you do can break anything. I will not be able to help you during the tasks, even if you ask.
Please think out loud. Can I record the screen and audio?"

Task briefing (read verbatim, per task):

"Here is the situation: [situation]. Do it the way you would if this were real. Tell me what you
are looking at and what you expect to happen. When you think you are done, say done."

Between tasks, ask exactly two questions:

1. "What was the hardest part of that?"
2. "In your own words, what would you tell another person this screen does?"

## Task scenarios

Tasks map one-to-one onto the five core journeys. Task ids (T1 to T5) are stable and are quoted
in the findings log. Every task starts from the state the previous task left behind, except T1,
which starts from a cleared device.

### T1: Set up a fund and invite two co-approvers

Situation: "You are the treasurer of a residents association. The club decided to raise money
for a festival, and you agreed to set up the fund on this tool."

- Start: cleared device, open on the landing page. The participant must find their own way to
  fund setup (path: landing, then `/onboarding`).
- Success: the participant reaches the "Your fund is ready" screen and has shared at least one
  approver invite on WhatsApp (in the sandbox, WhatsApp is simulated).
- Known risk being tested: the paise target field (J1-S2). Record whether the participant
  enters rupees by mistake and whether the error copy recovers them.
- Watch for: participants who pause on "UPI VPA" (J1-S3) and on "2-of-3" wording (J1-S4).

### T2: Donate by UPI and check the receipt

Situation: "Your neighbour shared a link to the club fund. You want to give Rs 500 by UPI and
later check that your donation is really recorded."

- Start: the public fund page for a seeded fund on the participant's phone.
- Success: the participant records a donation with a 12-digit reference, opens the receipt and
  taps through to the verification record, then says in their own words what the verification
  result told them.
- Watch for: whether "waiting for the bank" (J2-S5) is understood as honest waiting or read as
  failure; whether the QR and "Open your UPI app" are both noticed (J2-S3).

### T3: File an expense with a photo of the bill

Situation: "You are still the treasurer. The club just bought stage lights for Rs 2,500 and you
have a paper bill in your hand."

- Start: the treasurer dashboard of the same fund.
- Success: the participant submits the request with a camera-captured bill photo and can point
  to where the request now waits for approvers.
- Watch for: camera vs file choice (J3-S3), the uploading progress state on a throttled
  connection, and whether "Spendable balance" dropping after submission is noticed or alarming.

### T4: Approve a claim as a co-approver

Situation: "You are one of two approvers for this fund. A request just arrived on WhatsApp from
the treasurer. Decide what to do about it."

- Start: the WhatsApp deep link to `/funds/[fundId]/approvals/[expenseId]`.
- Run twice per participant: once approving (with the PIN dialog), once rejecting (with a
  reason). The second run starts from a second seeded request.
- Success: the participant approves one request, rejects the other with a reason, and can say
  what happened to the money in each case.
- Watch for: PIN lockout copy comprehension (only if the participant triggers it naturally,
  never force failures), and whether "Approve" and "Reject" read as equal-weight choices (J4-S1).

### T5: Check the public record as a stranger

Situation: "You are not a member of this club. Someone said the club spent money on stage
lights. Find out whether that is true."

- Start: the public fund page, signed out, on a phone.
- Success: the participant finds the expense in the timeline, opens its record on the verify
  page and states whether the record has changed since it was written.
- Second probe: disconnect the network, reload, and ask what the "saved copy" banner means
  (J5-S1) and whether they would still trust the numbers.
- Watch for: whether the "How do I know?" explainer is opened spontaneously; if it is not, ask
  about it in the debrief, never during the task.

## Task flow rules

- Order: T1, T2, T3, T4, T5 for treasurers. For donor-only participants (for example club
  members), run T2, T5, then T3 as an observer-aided demo, and skip T1 and T4.
- Abandonment: if the participant is stuck for 3 minutes with no progress, or asks for help a
  second time on the same step, end the task, mark it abandoned, and move on. Note the exact
  screen and the copy they last read.
- Time to done: measure from the end of the task briefing to the participant saying done. Log
  it; targets per task are defined in the findings log.

## Debrief questions

1. "If you had to describe Yen to your club in one sentence, what would you say?"
2. "Which screen would you change first, and how?"
3. "Was there any moment you did not trust what the screen told you?"
4. "What did you expect to happen that did not happen?"
5. Hindi-language sessions only: "Was anything worded in a way that felt like translated
   English rather than natural Hindi? Point at it if you remember where."

## Scoring and thresholds

Each task gets three measures:

| Measure | Definition | Pilot target |
| --- | --- | --- |
| Completion rate | participants finishing unaided | 4 of 5 per task |
| Time to done | median across successful runs | under 4 minutes (T1 under 8) |
| Confidence | participant's own 1 to 5 rating after the task | median 4 or higher |

A screen goes on the fix list when, in a single round of 5 participants: 2 or more fail the same
step, or 1 participant actively distrusts the screen (money promise, verification outcome,
saved copy). This threshold matches common small-sample usability practice: with 5 users the
method reliably surfaces the most frequent problems, not rare ones.

Round sizes: pilot with 5 treasurers and 5 donors (2 rounds of 5 total sessions per role is
enough for the first fix cycle). Re-run only the failed tasks after fixes land.

## Findings log template

One log per session, plus a round summary. Copy the templates below for each session; keep ids
stable so findings can be cross-referenced in issues.

### Session log

```
Session id: UX-<round>-<session>          Date: YYYY-MM-DD
Role: treasurer | co-approver | donor     Language: en | hi
Device: participant phone (375 px) | test phone
Connection notes: normal | throttled task: T<n> | offline task: T<n>

Per task:

Task: T<n> <journey name>
Completed unaided: yes | no        Time to done: mm:ss
Assists: none | <what was said>
Abandoned: no | yes at <screen id / copy shown>

Stuck points:
- Screen: <J?-S? or route>   Copy last read: "<exact string>"   Duration: <s>
  Participant said: "<quote>"

Verbatim highlights worth keeping: "<quote>"
Debrief notes: <short answers to the five debrief questions>
Confidence ratings: T1 <1-5> T2 <1-5> T3 <1-5> T4 <1-5> T5 <1-5>
```

### Finding entry (one per problem, written the same day)

```
Finding id: F-<round>-<n>          Session: UX-<round>-<session>
Journey / screen: <journey n, J?-S?, route>
Task: T<n>
Severity: blocker | major | minor
Category: plain language | trust | navigation | state clarity | translation parity | form entry

What happened: <one factual sentence, with the exact copy on screen>
What the participant did: <behaviour, not interpretation>
Participant quote: "<exact words, language as spoken>"
Proposed change: <smallest change that removes the stuck point>
Message keys touched: <comma separated keys from apps/web/src/i18n/messages/en.ts>
```

Severity guide: blocker means the task cannot be completed unaided; major means it completes
but wrong, or the participant distrusts a money promise; minor is friction without failure.

### Round summary

```
Round: <n>            Sessions: 5 treasurers + 5 donors? <yes/no, list>

Per task table:
Task | Completion | Median time | Top finding ids

Fix list for this round (ordered by severity):
1. F-<round>-<n> - <one line>
...

Copy changes needed (keys): <list>
Follow-up issues filed: <list of issue ids>
```

## Ground rules for findings

- Quote copy exactly, including its language. Paraphrase in a separate field if needed.
- Record behaviour ("tapped Back twice, then read the error aloud"), never verdicts ("was
  confused"). Interpretation belongs in the round summary, backed by counts.
- Every finding that touches shipped copy must name its message keys so the bilingual parity
  check (English and Hindi) can be updated in the same change.
- Findings about trust (bank waiting, verification outcomes, saved copy) always get severity
  major or blocker, even when the participant still completed the task.
