# Pilot demo video script: 3 minutes, shot by shot

Status: pilot kit, YEN-51.

Audience: whoever records the pilot demo video. This script crosses three documents and stays
consistent with all of them: the journey specs in `docs/ux/five-core-journeys.md` (J1 to J5),
the recording procedure in `docs/runbooks/demo-recording.md`, and the support promises in
`docs/pilot/support-runbook.md`. Narration is written line by line in English and Hindi so the
same edit can ship in either language or both.

## Ground rules

- Total runtime: 180 seconds. Every shot below has a fixed window; if a take overruns, cut
  narration, not the honesty sentences. The sentences marked [honesty] are mandatory.
- Zero on-screen text promises that the app does not keep. If a component is simulated locally,
  the closer discloses it (section 6 of `docs/runbooks/demo-recording.md`).
- Record at 1440x900 or larger. One shot (shot 6) is recorded in a 390 px wide window to show
  the phone layout.
- The fund shown is the seeded demo fund; do not blur anything, the data is fictional.

## Pre-roll (never on camera)

Follow `docs/runbooks/demo-recording.md` exactly:

1. `pnpm demo:reset`, then `pnpm dev:full` (web on http://localhost:3000, API on
   http://localhost:3001).
2. Start the local ClamAV daemon and restart with `CLAMAV_HOST=localhost` so the bill upload
   works in shot 7.
3. Seed the browser session cookies and run the PIN setup calls for Aarav Sharma (treasurer),
   Priya Verma and Rohan Iyer (approvers) with recording PIN `482613`.
4. Prepare `assets/demo-fixtures/bill.jpg` (a real phone photo of a paper invoice).
5. Optional, for the anchored verify state in shot 10: local Anvil chain plus queue worker per
   section 8 of the runbook. Without it, shot 10 records the pending-seal state instead; both
   are honest, pick one and do not mix.

Seeded identifiers used below (from `packages/db/src/dev-seed.ts`):

| Thing                  | Value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Fund ID                | `01940000-0000-7000-8000-000000000002`                                             |
| Public fund URL        | `http://localhost:3000/funds/01940000-0000-7000-8000-000000000002`                 |
| Treasurer persona      | Aarav Sharma, cookie `yen_mock_session_treasurer_token`                            |
| Approver personas      | Priya Verma (`..._approver1_token`), Rohan Iyer (`..._approver2_token`, hi locale) |
| Backup pending expense | `01940000-0000-7000-8000-000000000062` (25,000 INR, batteries)                     |

## Shot list

| Shot | Window         | Screen or camera           | Route or target                                     | Length |
| ---- | -------------- | -------------------------- | --------------------------------------------------- | ------ |
| 1    | 00:00 to 00:12 | Screen                     | `/` landing, then title card                        | 12 s   |
| 2    | 00:12 to 00:40 | Screen                     | `/onboarding` wizard, steps 1 to 5                  | 28 s   |
| 3    | 00:40 to 00:54 | Screen                     | `/invites/accept?code=...` on second phone          | 14 s   |
| 4    | 00:54 to 01:14 | Screen                     | `/funds/[fundId]/donate`                            | 20 s   |
| 5    | 01:14 to 01:28 | Screen                     | `/receipts/[id]`                                    | 14 s   |
| 6    | 01:28 to 01:56 | Screen, 390 px window      | `/funds/[fundId]/treasurer` and `/expenses/new`     | 28 s   |
| 7    | 01:56 to 02:10 | Screen split with terminal | evidence upload API call                            | 14 s   |
| 8    | 02:10 to 02:34 | Screen                     | `/funds/[fundId]/approvals/[expenseId]` + PIN modal | 24 s   |
| 9    | 02:34 to 02:46 | Screen                     | quorum reached, second approver                     | 12 s   |
| 10   | 02:46 to 03:06 | Screen                     | `/funds/[fundId]` timeline, `/verify`               | 20 s   |
| 11   | 03:06 to 03:20 | Screen                     | closer card with support contact                    | 14 s   |

Windows sum to 200 seconds; the edit must land at 180. The cut points marked (cut to fit) are
the sanctioned trims: shorten shots 2, 4 and 10 narration, never the [honesty] lines.

## Shot narration and on-screen actions

### Shot 1: Title and landing (00:00 to 00:12)

On-screen: landing page `/` scrolls once, then a plain title card: "Yen: transparent club
funds" with a second line in Hindi.

- EN narration: "Student clubs raise money, and members want to know where it went. This is
  Yen, a transparent account book for one club fund."
- HI narration: "छात्र क्लब पैसा जुटाते हैं, और सदस्य जानना चाहते हैं कि पैसा कहाँ गया। यह है
  येन, एक क्लब फ़ंड की पारदर्शी खाता बही।"

### Shot 2: Treasurer creates the fund (00:12 to 00:40, cut to fit)

On-screen: Aarav walks the `/onboarding` wizard: club details, fund details (show the paise
hint), payment details (UPI VPA `iitd.robotics@sbi`), two approvers, visibility. End on the
"Your fund is ready" screen with the WhatsApp share buttons.

- EN narration: "The treasurer sets up the fund in five steps: club, fund purpose and target,
  the club's UPI ID, two co-approvers, and who can see the fund. Targets are entered in whole
  paise; the screen says so. When the fund is ready, the treasurer shares each approver invite
  on WhatsApp."
- HI narration: "खजांची पाँच कदमों में फ़ंड सेट करता है: क्लब, उद्देश्य और लक्ष्य, क्लब की UPI
  ID, दो सह-स्वीकर्ता, और फ़ंड कौन देखेगा। लक्ष्य पूरे पैसों में भरा जाता है; स्क्रीन यही कहती
  है। फ़ंड तैयार होते ही खजांची हर स्वीकर्ता का निमंत्रण WhatsApp पर भेजता है।"
- (cut to fit) Trim by fast-stepping the wizard between steps 1 and 4; hold step 5 and the
  ready screen for at least 6 seconds.

### Shot 3: Co-approver accepts (00:40 to 00:54)

On-screen: second phone profile, the invite link opens `/invites/accept`, name and phone
entered, "You are now an approver." confirmed.

- EN narration: "Each co-approver accepts the invite on their own phone, with the same number
  the invite went to. Setup needs two approvers before money can move."
- HI narration: "हर सह-स्वीकर्ता अपने ही फ़ोन पर निमंत्रण स्वीकार करता है, उसी नंबर से जिस पर
  निमंत्रण आया था। पैसा चलने से पहले दो स्वीकर्ताओं का सेटअप ज़रूरी है।"

### Shot 4: Donor gives by UPI (00:54 to 01:14, cut to fit)

On-screen: public fund page, then `/funds/[fundId]/donate`: amount chips, the UPI QR, then the
12-digit reference form. Submit and land on the "Donation recorded, waiting for the bank"
screen.

- EN narration: "A donor pays the club directly by UPI. Yen never touches the money. The donor
  records the 12-digit reference from their UPI app, and the donation shows as waiting until
  the club's bank statement confirms it. [honesty] Nothing is spendable before that match."
- HI narration: "दानदाता UPI से सीधे क्लब को भुगतान करता है। येन पैसा अपने पास नहीं रखता।
  दानदाता अपने UPI ऐप का 12 अंकों का संदर्भ दर्ज करता है, और क्लब के बैंक विवरण से पुष्टि होने
  तक दान प्रतीक्षारत दिखता है। [honesty] उससे पहले यह राशि खर्च योग्य नहीं होती।"
- (cut to fit) Trim the amount-chip pause; hold the pending screen for 4 seconds.

### Shot 5: Receipt certificate (01:14 to 01:28)

On-screen: `/receipts/[id]` with the "Awaiting bank statement" badge, then the tax notice
block.

- EN narration: "Every donation gets a receipt certificate with its own verification link. The
  receipt also says clearly that it is not an 80G tax receipt."
- HI narration: "हर दान की अपनी रसीद प्रमाणपत्र बनती है, जिसका अपना सत्यापन लिंक होता है।
  रसीद साफ बताती है कि यह 80G कर रसीद नहीं है।"

### Shot 6: Treasurer files an expense (01:28 to 01:56)

On-screen: treasurer dashboard in a 390 px wide window: spendable balance, then
`/funds/[fundId]/expenses/new`: 12500.00 to `Robu.in Innovation Labs`, purpose, camera
capturing the paper bill, review, submit. End on the pending list with "Submitted".

- EN narration: "The treasurer files an expense: amount, payee, purpose, and a photo of the
  paper bill, up to 10 megabytes. The moment it is submitted, the spendable balance drops by
  the same amount. That is the hold. [honesty] The money stays held until two approvals
  release it."
- HI narration: "खजांची खर्च दर्ज करता है: रकम, पाने वाला, उद्देश्य, और कागज़ी बिल की तस्वीर,
  अधिकतम 10 मेगाबाइट। प्रस्तुत होते ही खर्च योग्य शेष उतना घट जाता है। यही रोक है। [honesty]
  दो स्वीकृतियों से जारी होने तक यह पैसा रोका रहता है।"

### Shot 7: The bill is hashed and pinned (01:56 to 02:10)

On-screen: split view: the upload API response on the right terminal (`fileSha256`,
`duplicateDetected: false`, clean `scan`), the approval screen on the left.

- EN narration: "Before any approver sees the bill, the server computes its fingerprint and
  pins it. The exact bytes the approver sees are the bytes the treasurer uploaded."
- HI narration: "किसी स्वीकर्ता को बिल दिखने से पहले ही सर्वर उसका फ़िंगरप्रिंट बनाकर पिन कर
  देता है। स्वीकर्ता जो बाइट देखता है, वही बाइट खजांची ने अपलोड किए थे।"

### Shot 8: Co-approver approves with the PIN (02:10 to 02:34)

On-screen: Rohan's profile, hi locale: the approval screen for the new expense, amount largest
on screen, bill photo visible, then the PIN modal, `482613`, success toast, timeline at
1 of 2.

- EN narration: "The co-approver opens the WhatsApp link, checks the amount, the payee and the
  bill, and approves with a 6-digit PIN. A wrong PIN would lock after five tries; the screen
  says so."
- HI narration: "सह-स्वीकर्ता WhatsApp लिंक खोलकर रकम, पाने वाले और बिल जाँचता है, और 6 अंकों
  के पिन से स्वीकृति देता है। गलत पिन पाँच बार पर बंद हो जाता है; स्क्रीन यह बताती है।"

### Shot 9: Quorum (02:34 to 02:46)

On-screen: Priya's profile approving the same expense; status flips to approved; treasurer
dashboard balance updates.

- EN narration: "A single approver can never release money. The second approval reaches
  quorum, and the balance updates without anyone asking."
- HI narration: "अकेला स्वीकर्ता कभी पैसा जारी नहीं कर सकता। दूसरी स्वीकृति से पूर्ण संख्या पूरी
  होती है, और शेष बिना किसी कहे बदल जाता है।"

### Shot 10: Anyone can check the record (02:46 to 03:06, cut to fit)

On-screen: signed-out browser: public fund page, timeline badge tap, `/verify` running the
check, "Verified" outcome with the pass headline. If the local chain was configured, show the
on-chain registry line too.

- EN narration: "No sign-in, anyone with the link can open the fund, tap any record, and see
  whether it has been changed since it was written. The check runs in the browser."
- HI narration: "बिना साइन इन, लिंक रखने वाला कोई भी फ़ंड खोलकर कोई भी रिकॉर्ड जाँच सकता है कि
  वह लिखे जाने के बाद बदला या नहीं। यह जांच ब्राउज़र में ही चलती है।"
- (cut to fit) Trim the scroll on the fund page; hold the verification outcome for 4 seconds.

### Shot 11: Closer (03:06 to 03:20, edit ends at 03:00)

On-screen: plain card, three lines: "Yen never holds the money", "Two approvals before any
payout", "Every record can be checked by anyone". Last line: the pilot support contact and
locale note.

- EN narration: "During the pilot, the club's treasurer and approvers get WhatsApp support
  with a 30-minute response target during the fest. Part of the stack is simulated locally in
  this recording: SMS delivery, the virus scan and the on-chain anchor. The list is in the
  demo recording runbook."
- HI narration: "पायलट के दौरान क्लब के खजांची और स्वीकर्ताओं को WhatsApp सपोर्ट मिलता है,
  उत्सव के दिनों में 30 मिनट के भीतर जवाब के लक्ष्य के साथ। इस रिकॉर्डिंग में स्टैक के कुछ हिस्से
  लोकल रूप से सिमुलेटेड हैं: SMS डिलीवरी, वायरस स्कैन और ऑन-चेन एंकर। सूची डेमो रिकॉर्डिंग
  रनबुक में है।"

## Retake rules

- Reset between retakes: `pnpm demo:reset`, restart `pnpm dev:full`, repeat the pre-roll
  cookie and PIN steps, then re-record only the affected shot.
- If the Journey 1 retakes pile up, approve the seeded backup pending expense
  `01940000-0000-7000-8000-000000000062` in shots 8 and 9 instead; it starts every reset in
  `submitted` state with zero approvals.
- The verify page shows "Pending seal" until an anchor lands. Either wait for the 5-minute
  discovery tick with the local chain, or record the pending state and keep the narration
  neutral about on-chain status.
