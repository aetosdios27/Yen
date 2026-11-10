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
