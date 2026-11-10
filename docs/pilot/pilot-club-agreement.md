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

## 3. DPDP 2023 consent language / डीपीडीपी 2023 सहमति भाषा

The club reads the paragraph below to every treasurer and approver before onboarding, and
posts it (or its Hindi version) where donors can see it. It satisfies the notice-and-consent
expectations of the Digital Personal Data Protection Act, 2023 as understood in this
repository's documentation; the review caveat at the top of this document applies.

EN notice text (fill the bracketed values):

> "I agree to take part in the Yen pilot run by `<pilot team contact>` for `<club name>`. I
> understand that Yen stores my phone number and display name to give me my role (treasurer
> or approver), and stores my approval actions so the club's spending record stays verifiable.
> Donors give money directly to the club's own UPI account; Yen never holds the money. My
> public activity appears under a fund-scoped pseudonym, not my name. I can withdraw this
> consent and ask for correction or erasure of my personal data at any time by writing to
> `<grievance contact email>`; erasure will not rewrite the club's financial records, which
> are retained as club records. I have been told what data is stored, in
> `docs/privacy/data-inventory.md`."

HI notice text:

> "मैं `<club name>` के लिए `<pilot team contact>` द्वारा चलाए जा रहे येन पायलट में भाग लेने के
> लिए सहमत हूँ। मैं समझता/समझती हूँ कि येन मुझे भूमिका (खजांची या स्वीकर्ता) देने के लिए मेरा फ़ोन
> नंबर और नाम संग्रहित करता है, और क्लब के खर्च का रिकॉर्ड सत्यापन-योग्य रखने के लिए मेरी स्वीकृति
> दर्ज करता है। दानदाता पैसा सीधे क्लब के अपने UPI खाते में देते हैं; येन पैसा अपने पास नहीं
> रखता। सार्वजनिक रिकॉर्ड में मेरी गतिविधि मेरे नाम के बजाय फ़ंड-स्कोप्ड छद्म नाम (स्यूडोनिम) से
> दिखती है। मैं कभी भी `<grievance contact email>` पर लिखकर यह सहमति वापस ले सकता/सकती हूँ और
> अपने व्यक्तिगत डेटा का सुधार या मिटाना माँग सकता/सकती हूँ; मिटाने पर क्लब के वित्तीय रिकॉर्ड
> नहीं बदलते, जो क्लब रिकॉर्ड के रूप में रहते हैं। क्या डेटा संग्रहित है, यह मुझे
> `docs/privacy/data-inventory.md` से बताया गया है।"

Consent is recorded per person in the `consent_records` table with the notice version and
timestamp; withdrawal is likewise recorded and processed through
`docs/privacy/request-process.md`.

## 4. Observational usability protocol / प्रेक्षणात्मक उपयोगिता प्रोटोकॉल

The usability sessions run under `docs/ux/usability-interview-protocol.md`, which the club
agrees to before the first session. The rules the club relies on:

- Watch, do not help. The facilitator answers questions during tasks with one line: "Please
  try it the way you would at home." If a participant is stuck for 3 minutes, the task ends
  and the stuck point is recorded. Being stuck is a finding, not a failure of the participant.
- Sessions are recorded (screen and audio) only with verbal consent, taken verbatim from the
  facilitator script in the protocol.
- Tasks use the sandbox with fictional data. No real phone numbers, bank details or UPI
  references are captured during tasks.
- The club receives the anonymized findings; quotes are used in reports only with permission.
