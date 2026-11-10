# HOD pilot report template

Status: pilot kit, YEN-51. Fill every `<angle bracket>`; delete the guidance lines in italics
when the report is final.

Audience: the Head of Department who approved the pilot. Sources: the metrics come from
`scripts/pilot-metrics.ts` (`pnpm pilot:metrics`, output schema `yen.pilot-metrics.v1`), the
incidents come from the support log defined in `docs/pilot/support-runbook.md`, and the
feedback comes from the findings log of `docs/ux/usability-interview-protocol.md`. Every
number in the metrics table must be copy-pasted from the script output, never estimated.

---

## Pilot report: Yen deployment for `<club name>`

| Field            | Value                                                                |
| ---------------- | -------------------------------------------------------------------- |
| Department       | `<department>`                                                       |
| Club             | `<club name>`                                                        |
| Fund             | `<fund name and public link>`                                        |
| Pilot period     | `<start date>` to `<end date>`                                       |
| Report date      | `<date>`                                                             |
| Prepared by      | `<pilot coordinator>`                                                |
| Metrics snapshot | `pnpm pilot:metrics` run on `<date, time>` against `<host/database>` |

## 1. Executive summary

_Three to six sentences, no jargon. Answer: did the club raise and spend money through Yen,
did the two-approver rule hold, and what is the single biggest recommendation? Write the
numbers from sections 2 to 4 in plain language here, for example: the club raised Rs
`<amount>` from `<count>` donors, filed `<count>` expenses, and every payout had two
approvals. The pilot's biggest problem was `<one sentence>`._

## 2. Metrics

_Run `pnpm pilot:metrics` against the pilot database and paste the JSON output into the pilot
report appendix. The table below uses the same field names as the `yen.pilot-metrics.v1`
payload. Where the payload has null, write "no data" and explain why in the notes._

| Metric                             | Payload field                           | Value | Target       | Met |
| ---------------------------------- | --------------------------------------- | ----- | ------------ | --- |
| Clubs onboarded                    | `onboarding.clubsTotal`                 |       | 1            |     |
| Clubs with a live fund             | `onboarding.clubsWithFund`              |       | 1            |     |
| Time to first fund, median         | `onboarding.timeToFirstFund.p50Minutes` |       | `<= 60 min`  |     |
| Time to first fund, p90            | `onboarding.timeToFirstFund.p90Minutes` |       | `<= 180 min` |     |
| Expenses decided (quorum reached)  | `approvals.decidedExpenses`             |       | context      |     |
| Approval turnaround, median        | `approvals.p50Hours`                    |       | `< 24 h`     |     |
| Approval turnaround, p90           | `approvals.p90Hours`                    |       | `< 24 h`     |     |
| Approval turnaround, worst case    | `approvals.maxHours`                    |       | context      |     |
| Share approved within 24 h         | `approvals.within24hRate`               |       | `>= 0.9`     |     |
| Donation pledges recorded          | `donations.total`                       |       | context      |     |
| Pledges still awaiting bank match  | `donations.pledged`                     |       | context      |     |
| Donations verified by bank match   | `donations.verified`                    |       | context      |     |
| Donor verification conversion rate | `donations.conversionRate`              |       | `>= 0.8`     |     |
| Median pledge to verified lag      | `donations.medianVerificationMinutes`   |       | context      |     |

Notes on the numbers:

_One or two lines. Examples: a p90 approval turnaround above target because approver 2 was
travelling during `<dates>`; a low conversion rate because `<count>` donors typed a wrong
UPI reference; time to first fund of `<value>` minutes because the treasurer created the fund
during the onboarding session itself._

## 3. Incidents during the pilot

_One row per incident in the support log, with the severity as classified under
`docs/runbooks/incident-response.md`. An incident with no severity assignment is not a closed
incident; classify it before reporting._

| Date | Severity (SEV-1/2/3) | One-line description | Resolution | Time to first response | Closed |
| ---- | -------------------- | -------------------- | ---------- | ---------------------- | ------ |
|      |                      |                      |            |                        |        |

Incident summary: `<count>` SEV-1, `<count>` SEV-2, `<count>` SEV-3. SLA (first response under
30 minutes during the fest) met in `<count>` of `<count>` support reports.

## 4. Student feedback summary

_From the usability sessions run under `docs/ux/usability-interview-protocol.md` (tasks T1 to
T5) and the debrief answers. Report findings, not opinions: which task, which screen, what the
participant did. Quote participants only with permission._

| Session | Task (T1 to T5) | Language | Outcome (done / abandoned / needed prompt) | Finding |
| ------- | --------------- | -------- | ------------------------------------------ | ------- |
|         |                 |          |                                            |         |

Top three findings across sessions:

1. `<finding and the screen id it maps to, for example J1-S2>`
2. `<finding>`
3. `<finding>`

Feedback themes in one paragraph: _what participants said the tool is for, what they did not
trust, and what they would change first._

## 5. Recommendation

_Pick one and justify with the sections above:_

- **Continue and expand** (recommended when: metrics met, no open SEV-1, feedback themes are
  refinements rather than blockers).
- **Continue with changes** (name the changes; each maps to a finding in section 4 or an
  incident in section 3).
- **Pause** (open SEV-1, or a data-integrity concern; state what must be true to restart).

Recommendation: `<one of the above>`, for the reasons in sections 2 to 4.

## 6. Sign-off

| Role               | Name | Signature | Date |
| ------------------ | ---- | --------- | ---- |
| Pilot coordinator  |      |           |      |
| Faculty advisor    |      |           |      |
| Head of Department |      |           |      |

## Appendix: metrics payload

_Paste the full `pnpm pilot:metrics` JSON output here, unmodified, including the
`generatedAt` timestamp. This is the evidence trail for the table in section 2._
