# Pilot support runbook: WhatsApp support channel

Status: pilot kit, YEN-51.

Audience: the pilot coordinator and the support volunteers who answer the club's WhatsApp
support channel during the pilot. This runbook defines the triage workflow, the response SLA,
bilingual reply templates for the four most common issue types, and when to hand a report to
the incident process in `docs/runbooks/incident-response.md`.

Companion documents: `docs/pilot/onboarding-guide.md` (what users were told), and
`docs/runbooks/incident-response.md` (severity model, on-call rotation, escalation tree).

## 1. Channel setup

- One WhatsApp group per club, named `Yen Support - <club name>`, plus one private channel for
  coordinators. Users report issues in the club group; coordinators move anything sensitive
  (screenshots with phone numbers, bank details) to the private channel and ask the user to
  delete it from the group.
- The pinned message in each group carries: the onboarding guide, the current pilot on-call
  name, and the one-line rule "Support never asks for your approval PIN."
- Support hours: 09:00 to 23:00 local during the fest and the pilot week; otherwise same-day
  responses.

## 2. Response SLA

| Situation                                 | First response target      | Resolution target    |
| ----------------------------------------- | -------------------------- | -------------------- |
| Fest week and pilot week, 09:00 to 23:00  | Under 30 minutes           | Same day             |
| Fest week outside 09:00 to 23:00          | Next morning, by 10:00     | Same day             |
| Anything classified SEV-1 (see section 5) | Under 15 minutes, any hour | Per incident process |

The first response is not the answer; it is the acknowledgement template (section 4, T0) plus
a severity guess. Users tolerate a slow fix far better than silence, and the acknowledgement
timestamp is what the SLA measures.

## 3. Triage workflow

For every incoming message:

1. **Acknowledge** with template T0 within the SLA window.
2. **Collect** with template T0 follow-ups if missing: club name, who is affected (treasurer,
   approver, donor), which screen (ask for the last screen they saw), and the exact identifier
   involved (fund link, expense id from the approval URL, 12-digit UPI reference). Never ask
   for OTPs, PINs, or full phone screenshots showing other people's numbers.
3. **Classify** using the severity model of `docs/runbooks/incident-response.md`, mapped for
   support:
   - SEV-1: money path blocked or data integrity in doubt. Examples: no donation can be
     recorded; approvals stuck for the whole fund; public fund page down; suspicion a record
     changed. Hand to the incident process within 15 minutes (section 5).
   - SEV-2: degraded but not blocking money. Examples: one upload failing; notification not
     arriving while the user can still act; verify page errors for one record.
   - SEV-3: cosmetic or a workaround exists. Examples: a confusing label, a slow page.
4. **Resolve** using the templates below or a runbook; **log** every report in the support log
   (section 6) with the classification and outcome. The log feeds the HOD pilot report.
