# Student club pilot agreement

Status: pilot kit, YEN-51. Template for the pilot phase; fill every `<angle bracket>` before
signing.

This agreement is between `<club name>` (the club) and the Yen pilot team (`<pilot team
contact>`). It states what the pilot involves, what data Yen stores, what the club and the
pilot team commit to, and how either side exits. It is an operational document for the pilot:
it is not legal advice, and the DPDP 2023 language below needs review by a qualified lawyer or
mentor before wider deployment, as noted in `docs/privacy/request-process.md`.

## 1. What the pilot involves / पायलट में क्या शामिल है

| Commitment      | Details                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Pilot period    | `<start date>` to `<end date>`, covering the fest window.                                            |
| Fund in scope   | One fund per club on the pilot deployment, used for real club fundraising.                           |
| People in scope | One treasurer, two to three approvers, and club members and donors who choose to donate.             |
| Usage sessions  | The pilot team runs 3 to 5 usability sessions per club under the observational protocol (section 4). |
| Support         | WhatsApp support channel with the SLA in `docs/pilot/support-runbook.md`.                            |
| Report          | The club receives the pilot report built from `docs/pilot/hod-pilot-report-template.md`.             |

## 2. Data handling commitments / डेटा संभाल की प्रतिबद्धता

### 2.1 What Yen stores

The full inventory is `docs/privacy/data-inventory.md`. The short list the club can quote to
members:

- Account data for the treasurer and approvers: phone number, display name, chosen locale.
- Donation records: amount, 12-digit UPI reference, and an optional donor display name and
  contact the donor chooses to give. Donations without a name stay anonymous.
- Expense records: amount, payee, purpose, and the uploaded bill photos or PDFs.
- Technical records: session and device trust data, notification delivery records, and the
  append-only event log of the fund.

### 2.2 Pseudonymization of donors and members

Every person acting in a fund (approving, filing, donating through an account) appears in the
public record under a fund-scoped pseudonym, a random identifier generated per person per fund
(`packages/db/src/pseudonyms.ts`). A pseudonym cannot be linked to the same person's activity
in another fund, and the mapping from pseudonym to person stays private. Donor names given on
the donation form are shown only when the donor typed one.

### 2.3 Evidence retention

Uploaded bills are club financial records: the file and its metadata are append-only and stay
with the fund for the financial-record lifetime. Erasure requests (section 5) remove or
anonymize personal data around the records, not the financial records themselves, consistent
with DPDP Act 2023 sections 12(3) and 8(7) as read in `docs/privacy/data-inventory.md`.

### 2.4 Never stored

The event log and the public chain records never contain names, phone numbers or contact
fields; the database triggers reject payloads that carry them. Sessions, OTPs and PIN records
are never written to the event log.
