# Demo Recording Runbook

Step-by-step recording sequence for the Yen demo video. Everything in this
runbook is verified against the seed script (`packages/db/src/dev-seed.ts`),
the API routes (`apps/api/src/contract.ts`, `apps/api/src/public-expense-contract.ts`)
and the web router (`apps/web/src/app`). A developer who has never touched the
repo should be able to reproduce every screen below without asking questions.

## 1. Prerequisites

| Requirement                | Version / value | Notes                                                        |
| -------------------------- | --------------- | ------------------------------------------------------------ |
| Node.js                    | 24.21.0         | pinned in `package.json` engines                             |
| pnpm                       | 12.6.0          | enabled through corepack                                     |
| Docker (or Podman) compose | any current     | runs PostgreSQL 16 and Redis 7 from `docker-compose.yml`     |
| ClamAV daemon              | optional        | without `CLAMAV_HOST` the local demo scanner accepts uploads |

One-time setup from the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose up -d          # PostgreSQL on :5432, Redis on :6379 (`pnpm dev:full` does this too)
```

## 2. Clean slate before every take

```sh
pnpm demo:reset
```

`pnpm demo:reset` (scripts/demo-reset.ts) performs, in order:

1. Deletes the local evidence upload directory. It honours `EVIDENCE_STORAGE_DIR`
   exactly like the API does; relative values resolve against `apps/api`
   (the dev server working directory) and the default is
   `apps/api/.data/evidence`. It prints the resolved path and how many files
   were removed, and refuses to delete the filesystem root, the repository
   root, or any parent of the repository root.
2. Drops the pg-boss queue schema (`QUEUE_SCHEMA`, default `pgboss`) so no
   jobs, schedules or dead letters from a previous run survive. The queue
   schema name is validated the same way the worker validates it, so the
   identifier is always safe to interpolate.
3. Drops and recreates the `public` schema. This clears the append-only
   event log, the anchor chain state (`anchors`, `anchor_event_salts`) and
   all other application tables, then re-runs every migration.
4. Reseeds the demo dataset described in section 3 and prints the fund,
   users, expenses, ledger balance and event count.

`pnpm db:reset` keeps its original database-only behaviour; `demo:reset` is a
superset. After the reset finishes, start the stack:

```sh
pnpm dev:full
```

`dev:full` waits for PostgreSQL, seeds if needed and boots:

- Next.js web app on http://localhost:3000
- Hono API on http://localhost:3001 (`NEXT_PUBLIC_API_URL` defaults to
  http://localhost:3001)
- the local chain and the anchoring worker (section 8)

`dev:full` starts the API with `OBJECTION_WINDOW_SECONDS=5`, so the 48 hour
donor objection window that normally follows an expense submission lasts five
seconds in the demo. The override exists only for `NODE_ENV=development`.

Redis is currently started by compose but no application code connects to it;
rate limits, queues and anchor state all live in PostgreSQL.

## 3. Seeded demo dataset and credentials

Every value in this section is read directly from
`packages/db/src/dev-seed.ts` (`SEED_CONSTANTS` and `seedDevDatabase`).
Nothing below is invented.

Organization: `IIT Delhi Robotics Club` (`student_society`).

Fund: `RoboCup 2026 Asia Fund`, public visibility, target 10,00,000 INR,
payee VPA `iitd.robotics@sbi`, payee name `IIT Delhi Robotics Club` (both
shown on the donate page).

Fund ID (used in URLs and curl calls throughout this runbook):

```
01940000-0000-7000-8000-000000000002
```

Seeded accounts. Sign in as any of them from the browser (section 4):

| Persona         | Role           | Phone (E.164) | Locale |
| --------------- | -------------- | ------------- | ------ |
| Aarav Sharma    | treasurer      | +919876543210 | en     |
| Priya Verma     | approver       | +919876543211 | en     |
| Rohan Iyer      | approver       | +919876543212 | hi     |
| Ananya Sen      | member (donor) | +919876543213 | en     |
| Vikram Malhotra | member (donor) | +919876543214 | en     |
| Sunita Rao      | member (donor) | +919876543215 | hi     |

Seeded donations (all verified against bank transactions in the seed):

| Donor           | Amount       | UTR          |
| --------------- | ------------ | ------------ |
| Ananya Sen      | 2,00,000 INR | 123456789012 |
| Vikram Malhotra | 2,00,000 INR | 123456789013 |
| Sunita Rao      | 1,00,000 INR | 123456789014 |

Ledger balance after the seeded paid expense: 4,65,000.00 INR, zero-sum
verified, 23 chained audit events. The public fund page counts only the three
matched donations (5,00,000.00 INR raised, nothing spent) because the seeded
expenses live in `expense_requests`, which the API does not read; spending
shows up once the journey below reconciles an expense.

Seeded expenses:

| Expense                                | Amount     | Status                       | Description                                                             |
| -------------------------------------- | ---------- | ---------------------------- | ----------------------------------------------------------------------- |
| `01940000-0000-7000-8000-000000000061` | 75,000 INR | approved                     | High-torque brushless motor set and ESCs, evidence `motors_invoice.pdf` |
| `01940000-0000-7000-8000-000000000062` | 25,000 INR | submitted (pending approval) | LiPo battery packs and safety charging station                          |
| `01940000-0000-7000-8000-000000000063` | 35,000 INR | paid                         | RoboCup Asia Pacific 2026 Team Registration Fee, UTR 987654321001       |

### OTPs and PINs: what is real and what is simulated

- OTPs are not seeded. Every code is generated at request time by
  `generateOtpCode()` in `apps/api/src/auth/crypto.ts` (cryptographically
  random, six digits), hashed at rest and checked by the real verify route with
  its normal rate limits. In local development the code is handed to
  `DevStubOtpDeliveryProvider` (`apps/api/src/auth/provider.ts`) instead of
  WhatsApp or SMS, and the send response carries it as `simulatedDelivery.code`.
  The login screen shows it under a "Simulated delivery" notice and fills it
  in. The stub refuses to construct when `NODE_ENV=production`, so production
  never returns a code.
- PINs are not seeded. Each persona creates its PIN on first sign-in after a
  reset (section 4). The recording PIN used throughout this runbook is
  `482613`; it passes `validatePin` in `apps/api/src/pin/rules.ts` (six
  digits, not a common PIN, no repeating pattern, no ascending or descending
  run, not derived from the seeded phone numbers or user IDs). Later sign-ins
  of the same persona unlock the device with the same PIN.
- Passkeys (WebAuthn) are optional in the product and are not used in this
  recording; approvals are authorized with the PIN, which is the default
  flow in the approval modal.

## 4. Signing in for each take

Everything is done in the browser; no devtools or curl.

1. Open http://localhost:3000/login, enter the persona's phone number from
   section 3 and press **Send code**. The screen shows a "Simulated delivery"
   notice with the code and fills it in.
2. Press **Verify and continue**.
3. PIN step. After a `pnpm demo:reset` the persona has no PIN yet, so the
   screen asks to create one: enter `482613` twice. This is also what makes
   the browser a trusted device (the API only unlocks authenticated routes for
   a session once the PIN is created or entered, `isPendingDeviceAuthRoute` in
   `apps/api/src/middleware.ts`). Do this once per persona before recording,
   not on camera. On later sign-ins the screen asks for the existing PIN to
   unlock the device.
4. The header now reads "Signed in as <name>". To switch persona press
   **Sign out** and repeat from step 1. Use a separate browser profile per
   persona if two personas must stay signed in side by side.

The trusted device has a 7-day idle timeout and a 30-day absolute lifetime, so
a full recording session fits comfortably.

### Terminal session for the API-only shots

The bank statement and reconciliation shots call the API directly (the web app
has no statement upload screen) and need a bearer token for the persona. After the persona has created its PIN in the browser,
obtain one from the same endpoints the login screen uses:

```sh
yen_token() { # usage: yen_token <phone>, prints a trusted bearer token
  local api=http://localhost:3001 jar; jar=$(mktemp)
  local code token
  code=$(curl -s -c "$jar" -X POST "$api/v1/auth/otp/send" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$1\",\"channel\":\"sms\"}" | sed -n 's/.*"code":"\([0-9]*\)".*/\1/p')
  token=$(curl -s -b "$jar" -c "$jar" -X POST "$api/v1/auth/otp/verify" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$1\",\"code\":\"$code\"}" | sed -n 's/.*"token":"\([0-9a-f]*\)".*/\1/p')
  curl -s -X POST "$api/v1/auth/device/unlock" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' -d '{"pin":"482613"}' > /dev/null
  echo "$token"
}
YEN_TOKEN=$(yen_token +919876543210)   # treasurer
```

Confirm authentication works before rolling:

```sh
curl -s http://localhost:3001/v1/me -H "Authorization: Bearer $YEN_TOKEN"
```

## 5. Sample files

The expense form (Journey 2) accepts `image/jpeg`, `image/png`, `image/webp`
and `application/pdf` up to 10 MB (`ALLOWED_EVIDENCE_MIME_TYPES` in
`apps/api/src/contract.ts`). The API checks the binary magic bytes against the
declared type (`apps/api/src/mime-signature.ts`) and computes the SHA-256
itself. A ready-made 8x8 PNG lives at `apps/web/e2e-real/fixtures/bill.png`.

For a real-looking shot, copy a phone photo of a paper invoice or a vendor PDF
bill to a folder outside the repository and pick it in the form. Keep it under
a few hundred KB so the upload completes quickly on camera.

The seeded expenses reference evidence only as metadata (`motors_invoice.pdf`,
`registration_receipt.pdf`); the seed inserts no stored bytes for them, and the
API does not read them at all. Use the expense created in Journey 2.

## 6. Journey 1: a donor pledges and the bank statement confirms it

Persona: any visitor (no sign-in needed) for the pledge, then Aarav Sharma
(treasurer) for the statement.

1. Donor pledge. Open
   http://localhost:3000/funds/01940000-0000-7000-8000-000000000002/donate
   (`apps/web/src/app/funds/[fundId]/donate/page.tsx`). The page shows the
   fund's UPI ID `iitd.robotics@sbi`. Enter an amount (for example `2500`), a
   12-digit UPI reference and a public name, then press **Record my donation**.
   The page says "Donation recorded, waiting for the bank" and that nothing is
   spendable until the bank statement reflects it. Every reference can be
   recorded once; use a new 12-digit number per take.
2. Bank statement. Yen reads statements as CSV through
   `POST /v1/reconciliation/statements` (the bank feed is simulated, section 9).
   Run, with the treasurer token from section 4 and the same reference:

   ```sh
   yen_statement() { # usage: yen_statement "<csv rows, one per line>"
     curl -s -X POST http://localhost:3001/v1/reconciliation/statements \
       -H "Authorization: Bearer $YEN_TOKEN" -H 'Content-Type: application/json' \
       -d "$(node -e 'console.log(JSON.stringify({fundId: process.argv[1], csvContent: "Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt,Deposit Amt,Closing Balance\n" + process.argv[2]}))' \
         01940000-0000-7000-8000-000000000002 "$1")"
   }
   TODAY=$(date -u +%d/%m/%Y)
   yen_statement "$TODAY,\"UPI/CR/123456789099/MEERA KAPOOR/OKAXIS/DONATION\",123456789099,$TODAY,,2500.00,0.00"
   ```

   The response reports `matchedCount: 1` and the credit as `matched`.
3. Fund view. Reload http://localhost:3000/funds/01940000-0000-7000-8000-000000000002
   logged out. Total raised moves from 5,00,000.00 to 5,02,500.00 INR and the
   new donation joins the timeline with its public initials. Its verified badge
   turns green once the worker anchors it (section 8).

## 7. Journey 2: the treasurer files an expense with a bill, two approvers release it

### Treasurer files the expense

Persona: Aarav Sharma (treasurer), signed in as in section 4.

1. Treasurer console. Open
   http://localhost:3000/funds/01940000-0000-7000-8000-000000000002/treasurer
   (`apps/web/src/app/funds/[fundId]/treasurer/page.tsx`). It shows the
   spendable balance and the pending expense list.
2. New expense. Click "New expense" (`/funds/{fundId}/expenses/new`). Fill the form:
   - Amount (INR): `12500.00`
   - Payee name: `Robu.in Innovation Labs`
   - Payee UPI VPA: `robu@ybl`
   - Purpose: `SBT kit and sensors for regional round`
   - Bill photo or PDF: pick the fixture from section 5
3. Review and submit. Click "Review expense", check the summary (it lists the
   file name), then "Submit expense". The app creates the request
   (`POST /v1/funds/{fundId}/expenses`), uploads the bill to
   `POST /v1/funds/{fundId}/expenses/{expenseId}/evidence`, and only then submits
   (`POST .../submit`). If the upload fails the form shows the error and the
   request stays a draft. The app then redirects to the treasurer console.
4. Open the request. The pending list links each row to
   `/funds/{fundId}/approvals/{expenseId}`; keep that URL for the approvers.

### Co-approvers release it with the PIN

Personas: Priya Verma, then Rohan Iyer (PIN `482613`), each in a fresh browser
profile.

1. Review screen. Open the approval URL. Show the status badge, the exact
   amount, payee, payee UPI VPA, purpose, requested-by row and the request
   progress with the 2-of-2 quorum.
2. Open the bill. The receipts row lists the uploaded file; clicking it opens
   `GET /v1/funds/{fundId}/expenses/{expenseId}/evidence/{evidenceId}/download`
   in a new tab. The API re-verifies the stored bytes against the SHA-256 pinned
   at upload before serving them (`apps/api/src/app.ts`, `downloadEvidenceRoute`).
   Approvers and the treasurer can read evidence; only the fund owner can attach it.
3. Approve with the PIN. Wait a few seconds after the submission: the
   development objection window lasts five seconds and approvals given inside it
   never turn into a quorum on their own. Click "Approve", type `482613` and
   confirm. The modal verifies the PIN against an action hash
   (`POST /v1/auth/pin/verify`) and sends the single-use 60-second approval token
   to `POST .../approve`. The page shows "Expense successfully approved" and
   "Approvals (1 of 2)".
4. Reach quorum. Sign out and repeat as the second approver. The status becomes
   approved and the page says "This request has already been approved". A single
   approver can never release money.
5. Lockout safety net (optional b-roll). Type a wrong PIN once and narrate the
   error copy; five consecutive failures lock approvals for 30 minutes and ten
   failures in 24 hours require recovery, so do not demonstrate past the first.

Only members who hold the approver role can approve: the API answers a donor
with 403 even though the page still shows the **Approve** button to every
signed-in viewer.

### The bank debit settles the expense

Persona: Aarav Sharma (treasurer), terminal. The club pays the vendor from its
bank app; the next statement carries the debit. Ingest it with the narration
and the payee VPA, for the same amount:

```sh
yen_statement "$TODAY,\"UPI/DR/123456789098/robu@ybl/Robu.in Innovation Labs\",123456789098,$TODAY,12500.00,,0.00"
```

The matcher (`apps/api/src/reconciliation/debit-matching.ts`) pairs an approved
expense with a debit of the same amount whose counterparty VPA equals the
expense's recipient and that posts within seven days of approval. The expense
becomes `paid`, the ledger hold settles and `bank.debit_seen` is appended. The
response lists the debit as `matched`; copy its `id` as `BANK_TX_ID` and
reconcile the expense:

```sh
curl -s -X POST http://localhost:3001/v1/funds/01940000-0000-7000-8000-000000000002/expenses/EXPENSE_ID/reconcile \
  -H "Authorization: Bearer $YEN_TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d '{"bankTransactionId":"BANK_TX_ID"}'
```

The expense is now `reconciled`. A debit that matches no approved expense is
recorded as an unapproved debit and raises a warning alert instead.

## 8. Journey 3: public fund view, transaction verification and Merkle proof

Persona: none; everything in this journey is public, no cookie needed. Record
it in a clean browser profile so no session leaks into the shot.

### Anchor availability

The record proof endpoint returns `status: "pending"` with a
`pendingWindow` message until an anchor has landed for the event. `pnpm dev:full`
starts everything needed to record the anchored state, with no extra terminals:

- an Anvil chain (chain id 31337, one block per second) from the `chain`
  profile in `docker-compose.yml`, on host port 8545 (`ANVIL_PORT` changes it);
- `RootRegistry`, deployed to that chain with `forge` inside the container, at
  the fixed address `0x5FbDB2315678afecb367f032d93F642f64180aa3`;
- the queue worker (`pnpm --filter @yen/queue start`), configured through the
  variables in `scripts/dev-chain.ts` (`workerChainEnv`): local signer using
  Anvil's first public account, `ANCHOR_CHAIN_ID=31337`, `QUEUE_MIGRATE=true` and a
  one-minute discovery interval (`ANCHOR_SCHEDULE_INTERVAL_MINUTES=1`; the
  production default stays five minutes).

The first start needs internet access to pull the Foundry image
(`ghcr.io/foundry-rs/foundry`) and its pinned compiler. Pass `--no-chain` to
`pnpm dev:full` to skip all of this and record the pending state instead.

Notes, all verified against the code:

- Timing: the seeded events anchor within a minute of the worker starting.
  After a new event, the verify page shows it as anchored within about a
  minute (the next discovery tick publishes it), and the anchor reaches
  `confirmed` (12 blocks, the state the public fund page counts) on the tick
  after that, so allow about two minutes before relying on confirmed state.
- `pnpm demo:reset` also wipes the local chain to genesis. The next
  `pnpm dev:full` redeploys the registry at the same address. If the database
  still holds anchors that the chain no longer has, `dev:full` stops and asks
  for `pnpm demo:reset`.
- The API proof response reports `contractAddress` from
  `REGISTRY_CONTRACT_ADDRESS`, and the browser reads the on-chain root from
  `NEXT_PUBLIC_LOCAL_CHAIN_RPC_URL`; `dev:full` sets both.
- Stop the stack with Ctrl+C. The chain container keeps running; stop it with
  `pnpm docker:down`.

### Shots

1. Public fund view. Open
   http://localhost:3000/funds/01940000-0000-7000-8000-000000000002 logged
   out, after the worker has anchored the Journey 1 and Journey 2 records
   (about two minutes after the reconciliation). Show the fund header, the
   money summary (raised, spent 12,500.00 INR, balance) and the activity
   timeline; each entry carries a verified badge that links to the proof page
   with `?recordId=...&fundId=...`
   (`apps/web/src/components/fund/verified-badge.tsx`).
2. Verify a transaction. Click the verified badge on the entry "An expense was
   marked reconciled." (12,500 INR) or on a donation entry. The
   verify page (`/verify`, `apps/web/src/app/verify/page.tsx`) fetches
   `GET /v1/funds/{fundId}/records/{recordId}/proof` and shows the event
   details, the anchor status and the verification result.
3. Merkle inclusion proof. On the same page, narrate the verification report:
   the client recomputes the record hash from the event and salt and checks
   the Merkle proof path against the public seal root
   (`apps/web/src/lib/verifier.ts`, `verifyEventProof`). The page also reads
   the root back from the registry on the local chain and reports the
   on-chain check, labelled "Simulated local chain, not a public network"
   ("Public registry seal verified"); with `--no-chain` it states that
   on-chain verification was skipped or offline.
4. Offline verification (optional closer). From the verify page, download the
   offline verifier script or the audit bundle and show that the same proof
   verifies without any server connection.

## 9. Components simulated in the demo

Say on camera (or in the description) which parts are simulated locally. This
list matches what the code actually does in local development.

| Component                | Local simulation                                                                                                                                                                                                                                                                                                                                                                                                         | Where it lives                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| SMS DLT gateway          | OTPs and notifications are handed to `DevStubOtpDeliveryProvider` / in-memory channel providers; no SMS is sent. Real sending requires the Exotel provider with DLT entity and template IDs via env credentials.                                                                                                                                                                                                         | `apps/api/src/auth/provider.ts`, `packages/notifications/src/channels/exotel-sms.ts`        |
| WhatsApp Business Cloud  | Same stub treatment; the Meta webhook receiver (`GET/POST /v1/delivery/webhooks/meta`) is mounted when `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` and `EXOTEL_RELAY_WEBHOOK_SECRET` are set.                                                                                                                                                                                                                         | `apps/api/src/server-bootstrap.ts`, `apps/api/src/delivery-webhooks.ts`                     |
| Payment partner webhooks | `POST /v1/reconciliation/webhooks/partner` accepts simulated UPI virtual account credit notifications. Requests must carry `X-Webhook-Timestamp` and `X-Webhook-Signature` (HMAC-SHA256 of `v1.<timestamp>.<body>` under `PARTNER_WEBHOOK_SECRET`); unsigned or tampered requests are rejected with 401.                                                                                                                 | `apps/api/src/app.ts` (`partnerWebhookRoute`)                                               |
| Virus scanner            | Without `CLAMAV_HOST` outside production the API uses `LocalDemoVirusScannerAdapter`: it logs a warning and reports every upload clean, with no malware detection. With `CLAMAV_HOST` set (`docker compose up clamav`), uploads are scanned over ClamAV's INSTREAM protocol (`ClamAvVirusScannerAdapter`). Production refuses the demo scanner.                                                                          | `apps/api/src/virus-scanner.ts`                                                             |
| Blockchain anchor        | Simulated: the queue worker publishes Merkle roots to a `RootRegistry` contract on a local Anvil chain (chain id 31337, started by `pnpm dev:full`), which the verify page labels "Simulated local chain, not a public network". Staging uses Polygon Amoy (80002). The worker signs with Anvil's public dev key (`ANCHOR_PRIVATE_KEY`, `ANCHOR_ALLOW_LOCAL_SIGNER=true`) outside production and with KMS in production. | `packages/queue/src/anchoring.ts`, `contracts/src/RootRegistry.sol`, `scripts/dev-chain.ts` |
| Bank statement feed      | The reconciliation statement endpoint ingests CSV bank statements, credits and debits, (`POST /v1/reconciliation/statements`) instead of a live bank API connection; there is no upload screen, so the demo posts the CSV from a terminal. The payout is not simulated through a partner either: the club "pays" outside Yen and the debit row on the next statement settles the expense.                                | `apps/api/src/reconciliation/`                                                              |
| Donor objection window   | Shortened for the demo: `pnpm dev:full` sets `OBJECTION_WINDOW_SECONDS=5`, so the 48 hour window after an expense is submitted lasts five seconds. The API reads the variable only with `NODE_ENV=development` set explicitly; unset, `test` and `production` always keep the policy window.                                                                                                                             | `apps/api/src/server-bootstrap.ts`, `scripts/dev-server-env.ts`                             |
| Redis                    | Started by docker compose but unused by application code; all durable state is PostgreSQL.                                                                                                                                                                                                                                                                                                                               | `docker-compose.yml`                                                                        |

## 10. Shot list and pacing

| Order | Screen                                   | Route                                   | Length target |
| ----- | ---------------------------------------- | --------------------------------------- | ------------- |
| 1     | Demo reset output in terminal            | `pnpm demo:reset`                       | 10 s          |
| 2     | Public landing page                      | `/`                                     | 8 s           |
| 3     | Public fund view                         | `/funds/{fundId}`                       | 15 s          |
| 4     | Treasurer console                        | `/funds/{fundId}/treasurer`             | 12 s          |
| 5     | New expense form, bill picked, review    | `/funds/{fundId}/expenses/new`          | 25 s          |
| 6     | Pledge and bank credit (terminal)        | `/donate` and API call                  | 20 s          |
| 7     | Co-approver review screen                | `/funds/{fundId}/approvals/{expenseId}` | 20 s          |
| 8     | PIN modal and approval toast             | modal                                   | 15 s          |
| 9     | Quorum reached (second approver)         | same route, other persona               | 10 s          |
| 10    | Public fund timeline with verified badge | `/funds/{fundId}`                       | 12 s          |
| 11    | Verify page with Merkle proof result     | `/verify?recordId=...&fundId=...`       | 20 s          |
| 12    | Offline verifier (optional)              | downloaded bundle                       | 10 s          |

Recording tips:

- Record at 1440x900 or larger; the UI is mobile-first, so consider a 390 px
  wide browser window for one app shot to show the phone layout.
- Reset between every retake: `pnpm demo:reset`, restart `pnpm dev:full`,
  sign in again as in section 4, then re-record the affected journey only.
- Rehearse the whole story unattended with `pnpm e2e:demo` (section 12).
- The three seeded expenses live in the `expense_requests` table, which the
  API does not read; the treasurer console and approval screens list only
  expenses created through the app (Journey 2). Create a fresh one per take.

## 11. Troubleshooting

| Symptom                                                    | Cause                                                                             | Fix                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Upload returns 503 "malware scanner is unavailable"        | `CLAMAV_HOST` is set but no ClamAV daemon answers there                           | Start the daemon (`docker compose up clamav`) or unset `CLAMAV_HOST`     |
| Upload returns 400 on a valid-looking file                 | Declared MIME type does not match the file magic bytes                            | Pick the original JPEG, PNG, WebP or PDF, not a renamed file             |
| Debit ingested but the expense stays `approved`            | Amount, payee VPA or approval date (7 days) differ from the statement row         | Match the amount and put the payee VPA (`robu@ybl`) in the narration     |
| Both approvals landed but the expense stays `submitted`    | Both were given inside the objection window                                       | Approve after the window (five seconds in dev) or resubmit a new expense |
| `/v1/me` returns 401 right after sign-in                   | The session is not a trusted device yet                                           | Finish the PIN step on the login screen (section 4)                      |
| PIN modal rejects the PIN                                  | PIN violates the rules in `apps/api/src/pin/rules.ts`                             | Use `482613` or another non-pattern six-digit PIN                        |
| Worker exits immediately with "Invalid worker environment" | Missing `DATABASE_URL`, or `ANCHOR_ALLOW_LOCAL_SIGNER` not `true` with no KMS key | Start through `pnpm dev:full`, which sets the worker environment         |
| Verify page says "proof data is incomplete"                | No anchor has landed yet (worker not running or discovery job not fired)          | Wait for the next one-minute discovery tick, or restart `pnpm dev:full`  |
| `demo:reset` fails with ECONNREFUSED                       | PostgreSQL is not running                                                         | `docker compose up -d` and retry                                         |

## 12. Rehearsing the whole story with `pnpm e2e:demo`

`pnpm e2e:demo` (`apps/web/e2e-real/demo-journey.spec.ts`, config in
`apps/web/playwright.real.config.ts`) drives Journeys 1 to 3 in a real browser
against the stack that `pnpm dev:full` runs: no stub API. It signs in as the
treasurer and both approvers through the login screen (simulated OTP, PIN), pledges a
donation, ingests the bank credit and debit, files an expense with a bill through
the form, approves it twice with the PIN, reconciles it, waits for the worker to
anchor the records and checks the public fund page and the verify page. Each
step leaves a screenshot in `apps/web/e2e-real/.results/shots` (override with
`E2E_SHOTS_DIR`).

```sh
pnpm demo:reset
pnpm dev:full                 # leave it running in its own terminal
pnpm --filter @yen/web e2e:install   # once, installs Chromium for Playwright
pnpm e2e:demo
```

The spec does not start the stack; it reads `WEB_PORT`, `API_PORT` and
`NEXT_PUBLIC_API_URL` like `dev:full` does, so export the same values for both.
Run `pnpm demo:reset` (and restart `dev:full`) before every run: the spec's
locators assume a clean fund timeline, and the OTP rate limits (five codes per
phone and ten per address every ten minutes) also allow only a few sign-ins.
Expect about two minutes, most of it waiting for the
one-minute anchoring tick. It is not part of the CI jobs because it needs the
containers.
