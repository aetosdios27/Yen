# Pilot onboarding guide: Yen for treasurers and co-approvers

Status: pilot kit, YEN-51.

Audience: the treasurer and the two (or three) co-approvers of a student club taking part in
the Yen pilot. This guide is two pages on paper. Every screen name, route and limit below was
checked against the app itself (`apps/web/src/app`) and against
`docs/ux/five-core-journeys.md`. Nothing here is invented.

| English                                                                               | हिन्दी                                                            |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Keep this guide next to you during setup. Every screen names exactly one next action. | सेटअप के दौरान यह गाइड पास रखें। हर स्क्रीन पर ठीक एक अगला कदम होता है। |

## 1. Before you start / शुरू करने से पहले

| You need (English)                                                                               | आपको चाहिए (हिन्दी)                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Your phone with the SIM that receives SMS.                                                       | आपका फ़ोन, जिसमें SMS आने वाला सिम हो।                                        |
| A UPI app on the same phone (GPay, PhonePe, Paytm or your bank app).                             | उसी फ़ोन पर कोई UPI ऐप (GPay, PhonePe, Paytm या बैंक का ऐप)।                 |
| The club's UPI ID (for example `club@sbi`) and the account name printed on the bank passbook.    | क्लब की UPI ID (जैसे `club@sbi`) और बैंक पासबुक पर छपा खाता नाम।                |
| Names and phone numbers of two co-approvers. They must not be you. A third approver is optional. | दो सह-स्वीकर्ताओं के नाम और फ़ोन नंबर। वे आप नहीं हो सकते। तीसरा स्वीकर्ता वैकल्पिक है। |
| The purpose of the fund and the target amount, decided by the club.                              | फ़ंड का उद्देश्य और लक्ष्य राशि, जो क्लब ने तय की है।                               |

| Rule to remember                                                                                     | याद रखने वाला नियम                                                                  |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Yen never holds the money. Donations go straight to the club's UPI. Yen only keeps the records.      | येन पैसा अपने पास नहीं रखता। दान सीधे क्लब के UPI में जाता है। येन सिर्फ रिकॉर्ड रखता है।        |
| Two approvals are required before any expense is released. One person alone can never release money. | कोई भी खर्च जारी होने से पहले दो स्वीकृतियाँ ज़रूरी हैं। अकेला व्यक्ति कभी पैसा जारी नहीं कर सकता। |

## 2. Account setup / खाता सेटअप

| English                                                                                                                                                                                | हिन्दी                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1. Open the app link the pilot team gave you and tap Sign in. This is the `/login` screen.                                                                                             | 1. पायलट टीम का दिया ऐप लिंक खोलें और साइन इन पर टैप करें। यह `/login` स्क्रीन है।                                                      |
| 2. Enter your phone number and tap the button to receive a 6-digit code (OTP) by SMS or WhatsApp.                                                                                      | 2. अपना फ़ोन नंबर डालें और SMS या WhatsApp पर 6 अंकों का कोड (OTP) पाने के बटन पर टैप करें।                                               |
| 3. Type the 6-digit code within its validity window. The code expires after a short time; ask the pilot team to resend it if it does not arrive (see `docs/pilot/support-runbook.md`). | 3. 6 अंकों का कोड डालें। कोड थोड़ी देर में समाप्त हो जाता है; न आए तो पायलट टीम से दोबारा भेजने को कहें (`docs/pilot/support-runbook.md` देखें)। |
| 4. That is the whole sign-in. There is no password to remember.                                                                                                                        | 4. साइन इन बस इतना ही है। कोई पासवर्ड याद रखना नहीं है।                                                                            |

## 3. Create a fund / फ़ंड बनाना

Open `/onboarding` (the pilot team links it from the landing page). The wizard has 5 steps and
your progress is saved on the device, so you can close it and come back.

| Step   | Screen asks           | What to enter (EN)                                                                                                                                | क्या भरें (HI)                                                                                               |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1 of 5 | Club details          | Club name and club type.                                                                                                                          | क्लब का नाम और क्लब का प्रकार।                                                                               |
| 2 of 5 | Fund details          | Purpose (required), description (optional), target amount. The target is entered in **whole paise**: for Rs 1,250.00 enter `125000`. No decimals. | उद्देश्य (ज़रूरी), विवरण (वैकल्पिक), लक्ष्य राशि। लक्ष्य **पूरे पैसों में** भरें: 1,250.00 रुपये के लिए `125000` भरें। दशमलव नहीं। |
| 3 of 5 | Payment details       | The club's UPI VPA (example `club@sbi`) and the payee name as the bank prints it.                                                                 | क्लब का UPI VPA (जैसे `club@sbi`) और बैंक में दर्ज पाने वाले का नाम।                                                |
| 4 of 5 | Approvers             | Two approvers (name + phone). The third is optional. Two approvals are always required.                                                           | दो स्वीकर्ता (नाम + फ़ोन)। तीसरा वैकल्पिक। दो स्वीकृतियाँ हमेशा ज़रूरी हैं।                                            |
| 5 of 5 | Visibility and create | Who can see this fund: Public, Donors only, or Members only. Then tap Create fund.                                                                | यह फ़ंड कौन देख सकता है: सार्वजनिक, केवल दानदाता, या केवल सदस्य। फिर फ़ंड बनाएँ पर टैप करें।                            |

When the screen says "Your fund is ready":

1. Tap **Share approver invite 1 on WhatsApp** and send it to approver 1. Repeat for approver 2
   (and 3 if nominated). Each invite opens WhatsApp with a link of the form
   `/invites/accept?code=...`.
2. Tap **Open fund** to see the public fund page `/funds/[fundId]` that donors will visit.

| English                                                                                                                                                                                                                                                                                                                           | हिन्दी                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When the screen says "Your fund is ready", tap Share approver invite 1 on WhatsApp and send it to approver 1. Repeat for approver 2 (and 3 if nominated). Each invite opens WhatsApp with a link of the form `/invites/accept?code=...`. Then tap Open fund to see the public fund page `/funds/[fundId]` that donors will visit. | जब स्क्रीन कहे "आपका फ़ंड तैयार है", तो स्वीकर्ता निमंत्रण 1 WhatsApp पर साझा करें पर टैप करके पहले स्वीकर्ता को भेजें। दूसरे (और नामित तीसरे) के लिए दोहराएँ। हर निमंत्रण `/invites/accept?code=...` रूप का लिंक खोलता है। फिर फ़ंड खोलें पर टैप करके वह सार्वजनिक फ़ंड पेज `/funds/[fundId]` देखें जिस पर दानदाता आएँगे। |

### The co-approver accepts the invite / सह-स्वीकर्ता निमंत्रण स्वीकार करता है

| English                                                                                                                                                                                                | हिन्दी                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each nominated person, on their own phone, opens the WhatsApp link and lands on `/invites/accept`. They enter their name and **the same phone number the invite was sent to**, then tap Accept invite. | हर नामित व्यक्ति अपने फ़ोन पर WhatsApp लिंक खोलकर `/invites/accept` पर पहुँचता है। वह अपना नाम और **वही फ़ोन नंबर जिस पर निमंत्रण आया** डालकर निमंत्रण स्वीकार करें दबाता है। |
| When the screen says "You are now an approver.", they are done. The invite link can be re-shared from the fund-ready screen if it expired.                                                             | स्क्रीन पर "अब आप अनुमोदक हैं।" दिखे तो काम पूरा। निमंत्रण की अवधि बीत गई हो तो फ़ंड-तैयार स्क्रीन से लिंक फिर भेजा जा सकता है।                                               |
