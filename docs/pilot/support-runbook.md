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

## 4. Bilingual response templates

Each template has an English and a Hindi version. Send the language the user wrote in. Keep
placeholders in `<angle brackets>`. The app's own copy (screen names in quotes) matches
`docs/pilot/onboarding-guide.md`.

### T0: Acknowledgement

EN: "Got it, thank you. We are looking into it and will update you within 30 minutes. Nothing
you did can break anything. To help faster, please send: which screen you were on, and the
link or reference number involved (never your PIN or OTP)."

HI: "समझ गए, धन्यवाद। हम देख रहे हैं और 30 मिनट के भीतर आपको अपडेट देंगे। आपके किए से कुछ खराब
नहीं हो सकता। जल्दी मदद के लिए कृपया भेजें: आप किस स्क्रीन पर थे, और संबंधित लिंक या संदर्भ
संख्या (अपना पिन या OTP कभी न भेजें)।"

### T1: Login OTP not arriving

EN: "If the 6-digit code did not arrive: 1) check that the number you entered is the SIM that
is in your phone; 2) wait 60 seconds, codes sometimes come slowly on festival networks;
3) then tap the resend option on the `/login` screen. If two attempts fail, tell us your
network (Jio, Airtel, Vi) and we will check the SMS gateway. Your account is fine; nothing was
lost."

HI: "अगर 6 अंकों का कोड नहीं आया: 1) देखें कि आपने वही नंबर डाला है जिसका सिम फ़ोन में है;
2) 60 सेकंड रुकें, उत्सव के दिनों में नेटवर्क धीमा होता है; 3) फिर `/login` स्क्रीन पर दोबारा
भेजने का विकल्प दबाएँ। अगर दो बार भी न आए, तो हमें अपना नेटवर्क बताएँ (Jio, Airtel, Vi), हम SMS
गेटवे जाँचेंगे। आपका खाता ठीक है; कुछ नहीं खोया।"

Escalation note: if several users on one network report missing OTPs together, treat it as
SEV-2 (notification delivery failing per `docs/runbooks/incident-response.md`) and hand it to
the on-call. In local development OTP delivery is stubbed and no code is sent at all; during
the pilot the SMS provider (Exotel with DLT templates, see
`docs/runbooks/demo-recording.md` section 9) must be configured.

### T2: Upload failing

EN: "For a bill photo that will not upload: 1) the file must be a photo (JPEG, PNG, WebP) or a
PDF, at most 10 MB; 2) if you are on mobile data, try Wi-Fi, the upload shows a percentage and
needs a few seconds on slow networks; 3) try the photo again with the same expense open. If
the message says the scanner is unavailable, wait 5 minutes and retry; the app refuses to
accept a bill it could not scan, and that is by design. Your expense request itself is safe."

HI: "अगर बिल की तस्वीर अपलोड नहीं हो रही: 1) फ़ाइल तस्वीर (JPEG, PNG, WebP) या PDF होनी चाहिए,
अधिकतम 10 MB; 2) मोबाइल डेटा पर हों तो Wi-Fi आज़माएँ, अपलोड प्रतिशत दिखाता है और धीमे नेटवर्क
पर कुछ सेकंड लेता है; 3) उसी खर्च को खोलकर तस्वीर फिर लगाएँ। अगर संदेश कहे कि स्कैनर उपलब्ध नहीं
है, तो 5 मिनट रुककर फिर कोशिश करें; ऐप बिना स्कैन किया हुआ बिल स्वीकार नहीं करता, यह जानबूझकर
है। आपका खर्च अनुरोध सुरक्षित है।"

Escalation note: a 503 "malware scanner is unavailable" on the pilot deployment is SEV-2
(money path still open: expenses can be submitted, evidence can follow). Two or more clubs
failing together is SEV-1 territory only if submissions themselves fail.

### T3: Approval PIN issues

EN, wrong PIN or lockout: "If the PIN was typed wrong, the screen shows how many attempts
remain; five wrong attempts lock approvals for 30 minutes, so the right move is to wait, then
try once more calmly. If you forgot the PIN, tell us and we will reset it; after a reset there
is a 24 hour cooling-off before the next approval, and no money is lost while you wait, the
request simply stays pending."

HI, गलत पिन या लॉक: "अगर पिन गलत टाइप हुआ, तो स्क्रीन बताती है कि कितने प्रयास बचे हैं; पाँच गलत
प्रयासों पर 30 मिनट के लिए स्वीकृति बंद हो जाती है, इसलिए ठीक तरीका है रुकना, फिर शांत होकर एक
बार कोशिश करना। अगर पिन भूल गए हैं, तो हमें बताएँ, हम उसे रीसेट कर देंगे; रीसेट के बाद अगली
स्वीकृति से पहले 24 घंटे का कूलिंग-ऑफ है, और इस दौरान कोई पैसा नहीं खोता, अनुरोध बस लंबित रहता
है।"

EN, permanent lockout: "After many wrong attempts the PIN needs an admin reset. We will do it
with you on a short call. Until then the other approver can act, so the club is not blocked."

HI, स्थायी लॉक: "बहुत सारे गलत प्रयासों के बाद पिन को एडमिन रीसेट की ज़रूरत होती है। हम एक छोटे
कॉल में आपके साथ यह करेंगे। तब तक दूसरा स्वीकर्ता काम कर सकता है, इसलिए क्लब अवरुद्ध नहीं है।"

Escalation note: PIN resets touch `user_approval_pins`; follow the recovery runbook the
platform team uses and record the reset in the support log. A request that never reaches
quorum expires after the approval window (72 hours by default) and releases its hold; say so
rather than promising manual intervention. If approvals are stuck for a whole fund with both
approvers healthy, that is SEV-1 (money path blocked).

### T4: Donor verification questions

EN, donation waiting: "Your donation shows as waiting because Yen matches your 12-digit UPI
reference against the club's bank statement. Until that match, the club cannot spend it; this
is the honest state, not an error. Matches happen when the treasurer's bank statement feed
runs. If it has been more than 2 days, send us your 12-digit reference and the fund link and
we will check."

HI, दान प्रतीक्षारत: "आपका दान प्रतीक्षारत इसलिए दिखता है क्योंकि येन आपके 12 अंकों के UPI
संदर्भ को क्लब के बैंक विवरण से मिलाता है। मिलान होने तक क्लब वह राशि खर्च नहीं कर सकता; यह ईमानदार
स्थिति है, गड़बड़ी नहीं। मिलान तब होता है जब खजांची का बैंक विवरण फ़ीड चलता है। अगर 2 दिन से ज़्यादा
हो गए हैं, तो अपना 12 अंकों का संदर्भ और फ़ंड लिंक भेजें, हम जाँचेंगे।"

EN, record check: "To check any record: open the fund page, find the entry in the timeline,
and tap Check this record. The page runs the check in your browser and says whether the record
has changed since it was written. If it says Verification failed, screenshot it immediately
and tell us; that is exactly what the page exists to catch."

HI, रिकॉर्ड जांच: "कोई भी रिकॉर्ड जाँचने के लिए: फ़ंड पेज खोलें, टाइमलाइन में प्रविष्टि ढूँढें, और
इस रिकॉर्ड की जांच करें दबाएँ। पेज जांच आपके ब्राउज़र में ही चलाता है और बताता है कि रिकॉर्ड लिखे
जाने के बाद बदला या नहीं। अगर उस पर सत्यापन विफल लिखा आए, तो तुरंत स्क्रीनशॉट लेकर हमें बताएँ;
पेज बस यही पकड़ने के लिए बना है।"

Escalation note: any donor report of "Verification failed" is SEV-1 until the responder on
call confirms it is a wrong link: "Any suspicion of tampering with the event log, the anchors,
or the salts is SEV-1 regardless of whether verification currently passes" (from
`docs/runbooks/incident-response.md`).

## 5. Escalation paths

1. **SEV-1 hand-off.** Post in the operations channel with the incident thread format from
   `docs/runbooks/incident-response.md` (timeline, severity, impact). The on-call primary owns
   it from that moment; support keeps the user informed with the club communication templates
   of that runbook. Acknowledgement target 15 minutes.
2. **SEV-2 hand-off.** Same channel, same format, severity SEV-2. Support may keep
   corresponding with the user while the on-call works the technical side.
3. **Security or privacy reports.** Anything that looks like a leak (an OTP seen by someone
   else, a bill photo on the wrong fund, a phone number on a public page) goes straight to the
   security owner in parallel with the SEV-1 hand-off, per the incident runbook. Do not
   investigate alone, and do not copy the material into the support group.
4. **Known-issue shortcuts.** Before escalating, check the troubleshooting table of
   `docs/runbooks/demo-recording.md` section 11: the 503 scanner message, the PIN rejection
   rules, the "pending seal" verify state and the demo reset requirements are all documented
   there with their causes.

## 6. Support log

Keep one append-only log file (or sheet) per pilot week. One line per report:

`<date time> | <club> | <who> | <one-line issue> | <SEV-1|SEV-2|SEV-3> | <template or runbook
used> | <resolved|escalated|waiting> | <minutes to first response>`

The HOD pilot report (`docs/pilot/hod-pilot-report-template.md`) pulls its incident table and
its SLA statistics straight from this log, and the pilot metrics script
(`scripts/pilot-metrics.ts`) provides the quantitative half. Log honestly; a slow first
response that is written down is a finding, not a failure.
