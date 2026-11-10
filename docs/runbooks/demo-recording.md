# Demo Recording Runbook

Step-by-step recording sequence for the Yen demo video. Everything in this
runbook is verified against the seed script (`packages/db/src/dev-seed.ts`),
the API routes (`apps/api/src/contract.ts`, `apps/api/src/public-expense-contract.ts`)
and the web router (`apps/web/src/app`). A developer who has never touched the
repo should be able to reproduce every screen below without asking questions.

## 1. Prerequisites

| Requirement                | Version / value          | Notes                                                    |
| -------------------------- | ------------------------ | -------------------------------------------------------- |
| Node.js                    | 24.21.0                  | pinned in `package.json` engines                         |
| pnpm                       | 12.6.0                   | enabled through corepack                                 |
| Docker (or Podman) compose | any current              | runs PostgreSQL 16 and Redis 7 from `docker-compose.yml` |
| ClamAV daemon              | any with INSTREAM on TCP | required only for the bill-upload step; see section 6    |

One-time setup from the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose up -d          # PostgreSQL on :5432, Redis on :6379
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

Redis is currently started by compose but no application code connects to it;
rate limits, queues and anchor state all live in PostgreSQL.

## 3. Seeded demo dataset and credentials

Every value in this section is read directly from
`packages/db/src/dev-seed.ts` (`SEED_CONSTANTS` and `seedDevDatabase`).
Nothing below is invented.

Organization: `IIT Delhi Robotics Club` (`student_society`).

Fund: `RoboCup 2026 Asia Fund`, public visibility, target 10,00,000 INR,
payee VPA `iitd.robotics@sbi`, payee name `IIT Delhi Robotics Club`.

Fund ID (used in URLs and curl calls throughout this runbook):

```
01940000-0000-7000-8000-000000000002
```

Seeded accounts. All six have active mock sessions valid for one year from
seed time, stored as SHA-256 token hashes in the `sessions` table:

| Persona         | Role           | Phone (E.164) | Locale | Mock session token                 |
| --------------- | -------------- | ------------- | ------ | ---------------------------------- |
| Aarav Sharma    | treasurer      | +919876543210 | en     | `yen_mock_session_treasurer_token` |
| Priya Verma     | approver       | +919876543211 | en     | `yen_mock_session_approver1_token` |
| Rohan Iyer      | approver       | +919876543212 | hi     | `yen_mock_session_approver2_token` |
| Ananya Sen      | member (donor) | +919876543213 | en     | `yen_mock_session_donor1_token`    |
| Vikram Malhotra | member (donor) | +919876543214 | en     | `yen_mock_session_donor2_token`    |
| Sunita Rao      | member (donor) | +919876543215 | hi     | `yen_mock_session_donor3_token`    |

Seeded donations (all verified against bank transactions in the seed):

| Donor           | Amount       | UTR          |
| --------------- | ------------ | ------------ |
| Ananya Sen      | 2,00,000 INR | 123456789012 |
| Vikram Malhotra | 2,00,000 INR | 123456789013 |
| Sunita Rao      | 1,00,000 INR | 123456789014 |

Ledger balance after the seeded paid expense: 4,65,000.00 INR, zero-sum
verified, 23 chained audit events.

Seeded expenses:

| Expense                                | Amount     | Status                       | Description                                                             |
| -------------------------------------- | ---------- | ---------------------------- | ----------------------------------------------------------------------- |
| `01940000-0000-7000-8000-000000000061` | 75,000 INR | approved                     | High-torque brushless motor set and ESCs, evidence `motors_invoice.pdf` |
| `01940000-0000-7000-8000-000000000062` | 25,000 INR | submitted (pending approval) | LiPo battery packs and safety charging station                          |
| `01940000-0000-7000-8000-000000000063` | 35,000 INR | paid                         | RoboCup Asia Pacific 2026 Team Registration Fee, UTR 987654321001       |

### OTPs and PINs: what is real and what is simulated

- OTPs are not seeded. Every code is generated at request time by
  `generateOtpCode()` in `apps/api/src/auth/crypto.ts` (cryptographically
  random, six digits). In local development the code is handed to
  `DevStubOtpDeliveryProvider` (`apps/api/src/auth/provider.ts`), which keeps
  it in memory only. No OTP is printed to the console or retrievable through
  any endpoint, so the `/login` OTP screen cannot be completed locally. That
  is why recording uses the seeded mock sessions below instead of typing an
  OTP on camera.
- PINs are not seeded either. Each persona used in an approval flow needs a
  one-time PIN setup call (section 4). The recording PIN used throughout this
  runbook is `482613`; it passes `validatePin` in `apps/api/src/pin/rules.ts`
  (six digits, not a common PIN, no repeating pattern, no ascending or
  descending run, not derived from the seeded phone numbers or user IDs).
- Passkeys (WebAuthn) are optional in the product and are not used in this
  recording; approvals are authorized with the PIN, which is the default
  flow in the approval modal.

## 4. Signing in for each take

The API reads the session from the `yen_session` cookie or an
`Authorization: Bearer` header (`apps/api/src/middleware.ts`). Because cookies
are not port-scoped, a cookie set on any `localhost` page is sent to the API on
`localhost:3001`. Sign in per persona as follows.

1. Seed the session cookie in the browser. Open http://localhost:3001/health
   in a tab, open the browser console and run:

   ```js
   document.cookie = "yen_session=yen_mock_session_treasurer_token; path=/; max-age=86400";
   ```

   Substitute the matching token from the table in section 3 for each persona.

2. Trust the device once per persona (before recording, not on camera). A
   session only becomes a trusted device after PIN setup
   (`isPendingDeviceAuthRoute` in `apps/api/src/middleware.ts` allows
   `/v1/auth/pin/setup` through), which is also what unlocks all
   authenticated routes:

   ```sh
   curl -s -X POST http://localhost:3001/v1/auth/pin/setup \
     -H 'Content-Type: application/json' \
     -b 'yen_session=yen_mock_session_treasurer_token' \
     -d '{"pin":"482613"}'
   # {"status":"created","isSet":true}
   ```

   Repeat with `yen_mock_session_approver2_token` for Rohan Iyer and any other
   persona that appears on camera. The trusted device then has a 7-day idle
   timeout and a 30-day absolute lifetime, so a full recording session fits
   comfortably.

3. Confirm authentication works before rolling:

   ```sh
   curl -s http://localhost:3001/v1/me \
     -b 'yen_session=yen_mock_session_treasurer_token'
   ```

## 5. Sample files

Uploads are accepted at `POST /v1/funds/{fundId}/expenses/{expenseId}/evidence`
with `multipart/form-data` field `file`. The API allows exactly these MIME
types (`ALLOWED_EVIDENCE_MIME_TYPES` in `apps/api/src/contract.ts`):
`image/jpeg`, `image/png`, `image/webp`, `application/pdf`. The binary magic
bytes must match the declared type (`apps/api/src/mime-signature.ts`), the
limit is 10 MB, and the server computes the SHA-256 itself.

Create a fixtures folder for the shoot:

```sh
mkdir -p assets/demo-fixtures
# copy a real phone photo of a paper invoice or a vendor PDF bill, for example:
cp ~/Downloads/robu-invoice-1042.jpg assets/demo-fixtures/bill.jpg
```

If you have no real bill image at hand, generate a small valid PNG so the
upload still passes the MIME signature check:

```sh
base64 -d > assets/demo-fixtures/bill.png <<'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8
z8DwnwEKmBhQMcOw/xcAqR0H95bG2k0AAAAASUVORK5CYII=
EOF
```

Keep the fixture under a few hundred KB so the upload progress bar is visible
but the upload completes quickly on camera.

The seeded expenses reference evidence only as metadata (`motors_invoice.pdf`,
`registration_receipt.pdf`); the seed inserts no stored bytes for them. For a
working bill inspection on camera, upload a fixture to the expense created in
Journey 1 and inspect that expense in Journey 2.

## 6. Journey 1: treasurer views the fund and submits an expense with a bill

Persona: Aarav Sharma (treasurer). Cookie:
`yen_mock_session_treasurer_token`.

### Before rolling

Start a local ClamAV daemon for the upload step; without a configured scanner
the upload endpoint fails closed by design (`UnconfiguredVirusScannerAdapter`,
`apps/api/src/virus-scanner.ts`). Any ClamAV build exposing the INSTREAM TCP
protocol works, for example:

```sh
docker run -d --name yen-clamav -p 3310:3310 clamav/clamav
```

Then restart `pnpm dev:full` with the scanner address so the API mounts
`ClamAvVirusScannerAdapter`:

```sh
CLAMAV_HOST=localhost pnpm dev:full
```

`CLAMAV_PORT` defaults to 3310. If the scanner is not running, skip the upload
step and say so on camera: rejecting unscanned uploads is a product feature,
not a bug.

### Shots

1. Fund view. Open http://localhost:3000/funds/01940000-0000-7000-8000-000000000002
   (`apps/web/src/app/funds/[fundId]/page.tsx`, `PublicFundView`). Show the
   fund header (RoboCup 2026 Asia Fund), money summary (4,65,000.00 INR
   balance against the 10,00,000.00 INR target) and the spending breakdown.
   Narrate that donors see this same page.
2. Treasurer console. Click through to
   http://localhost:3000/funds/01940000-0000-7000-8000-000000000002/treasurer.
   Show the spendable balance, the pending expense list (the seeded 25,000 INR
   battery expense) and the paid history.
3. New expense. Click "New expense", landing on
   `/funds/01940000-0000-7000-8000-000000000002/expenses/new`. Fill the form:
   - Amount (INR): `12500.00`
   - Payee name: `Robu.in Innovation Labs`
   - Payee UPI VPA: `robu@ybl`
   - Purpose: `SBT kit and sensors for regional round`
   - Receipt / Bill reference: `Invoice #1042` (optional)
4. Review and submit. Click "Review expense", verify the summary screen, then
   "Submit expense". The app creates the request
   (`POST /v1/funds/{fundId}/expenses`) and immediately submits it
   (`POST /v1/funds/{fundId}/expenses/{expenseId}/submit`), then redirects to
   the treasurer console where the new request sits in the pending list.
5. Capture the expense ID: the pending list links each row to
   `/funds/{fundId}/approvals/{expenseId}`. Copy that URL for Journey 2.
6. Bill upload. Attach the fixture to the new expense (this is the same call
   the `EvidenceUpload` component makes; the component lives in
   `apps/web/src/components/evidence-upload.tsx` and is exported but not yet
   mounted on a page, so the recording uses the API call):

   ```sh
   curl -s -X POST \
     http://localhost:3001/v1/funds/01940000-0000-7000-8000-000000000002/expenses/EXPENSE_ID/evidence \
     -b 'yen_session=yen_mock_session_treasurer_token' \
     -F 'file=@assets/demo-fixtures/bill.jpg;type=image/jpeg' \
     -F 'vendorName=Robu.in Innovation Labs' \
     -F 'invoiceNumber=1042'
   ```

   The response echoes `evidenceId`, the server-computed `fileSha256`,
   `duplicateDetected: false` and the clean `scan` result. Show the terminal
   with the response; narrate that the hash is pinned before any approver
   sees the file.

## 7. Journey 2: co-approver reviews the expense and approves with the PIN

Persona: Rohan Iyer (co-approver, hi locale). Cookie:
`yen_mock_session_approver2_token`, PIN `482613` (set up once in section 4).

### Shots

1. Review screen. In a fresh browser profile (so the UI reads as Rohan), open
   the approval URL captured in Journey 1:
   `http://localhost:3000/funds/01940000-0000-7000-8000-000000000002/approvals/EXPENSE_ID`
   (`apps/web/src/app/funds/[fundId]/approvals/[expenseId]/page.tsx`). Show:
   - status badge (pending) and the exact amount
   - payee name and payee UPI VPA
   - purpose and requested-by row (Aarav Sharma)
   - the receipts row, which shows the attached evidence reference
   - the expense timeline with the approval quorum (2 of 2)
2. Inspect the bill. On camera, narrate over the receipts row. The reviewer
   UI shows the receipt reference; the server pins the bytes to the SHA-256
   recorded at upload time. To display the verification data, run:

   ```sh
   curl -s http://localhost:3001/v1/funds/01940000-0000-7000-8000-000000000002/expenses/EXPENSE_ID/evidence \
     -b 'yen_session=yen_mock_session_approver2_token'
   ```

   The response lists each evidence item with its `fileSha256`, size and MIME
   type; the API re-verifies stored bytes against the pinned hash before
   returning (`apps/api/src/app.ts`, `getEvidenceRoute`).
3. Approve with the PIN. Click "Approve" to open the PIN modal
   (`ApprovalPinModal`), type `482613` and confirm. The modal first verifies
   the PIN against an action hash
   (`POST /v1/auth/pin/verify`) and receives a single-use 60-second approval
   token, then submits it to
   `POST /v1/funds/{fundId}/expenses/{expenseId}/approve`. Show the success
   toast and the timeline updating to 1 of 2 approvals.
4. Reach quorum. Repeat steps 1 to 3 as Priya Verma
   (`yen_mock_session_approver1_token`, her own PIN setup call in section 4)
   on the same expense. The expense status flips to approved once the second
   approval lands. Point out that a single approver can never release money.
5. Lockout safety net (optional b-roll). If you want to show it, type a wrong
   PIN once and narrate the error copy; five consecutive failures lock
   approvals for 30 minutes and ten failures in 24 hours require recovery, so
   do not demonstrate past the first failure.

## 8. Journey 3: public fund view, transaction verification and Merkle proof

Persona: none; everything in this journey is public, no cookie needed. Record
it in a clean browser profile so no session leaks into the shot.

### Anchor availability (optional but recommended)

The record proof endpoint returns `status: "pending"` with a
`pendingWindow` message until an anchor has landed for the event. To record
the full anchored state, run the queue worker against a local chain before
this journey:

```sh
# Terminal A: local EVM chain
anvil

# Terminal B: deploy RootRegistry with the publisher set to the worker signer
cd contracts
forge create src/RootRegistry.sol:RootRegistry \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --constructor-args 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A
```

The constructor argument is the address of the demo signer key below
(computed from that exact private key). Then start the worker:

```sh
DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres \
QUEUE_MIGRATE=true \
ANCHOR_RPC_URL=http://localhost:8545 \
ROOT_REGISTRY_ADDRESS=0x<DEPLOYED_ADDRESS> \
ANCHOR_PRIVATE_KEY=0x1111111111111111111111111111111111111111111111111111111111111111 \
ANCHOR_ALLOW_LOCAL_SIGNER=true \
pnpm --filter @yen/queue start
```

Notes, all verified against the code:

- `QUEUE_MIGRATE=true` is required on the first worker start after
  `pnpm demo:reset`, because the reset drops the pg-boss schema.
- The anchoring discovery job runs every 5 minutes
  (`registerAnchoringDiscovery` in `packages/queue/src/anchoring.ts`), so
  allow a few minutes between the expense approval and the anchored status.
- The API proof response reports `contractAddress` from
  `REGISTRY_CONTRACT_ADDRESS` when set; export it with the deployed address
  for a complete on-camera payload.
- Without a chain configured, the journey still works end to end: the verify
  page shows the pending state and the tamper-evident event log. Decide which
  story you want on camera.

### Shots

1. Public fund view. Open
   http://localhost:3000/funds/01940000-0000-7000-8000-000000000002 logged
   out. Show the fund header, money summary and the activity timeline; each
   entry carries a verified badge that links to the proof page with
   `?recordId=...&fundId=...` (`apps/web/src/components/fund/verified-badge.tsx`).
2. Verify a transaction. Click the verified badge on the paid expense entry
   (35,000 INR, UTR 987654321001) or on a donation verification entry. The
   verify page (`/verify`, `apps/web/src/app/verify/page.tsx`) fetches
   `GET /v1/funds/{fundId}/records/{recordId}/proof` and shows the event
   details, the anchor status and the verification result.
3. Merkle inclusion proof. On the same page, narrate the verification report:
   the client recomputes the record hash from the event and salt and checks
   the Merkle proof path against the public seal root
   (`apps/web/src/lib/verifier.ts`, `verifyEventProof`). With a local chain
   running, the page also reports the on-chain registry check; otherwise it
   states that on-chain verification was skipped or offline.
4. Offline verification (optional closer). From the verify page, download the
   offline verifier script or the audit bundle and show that the same proof
   verifies without any server connection.

## 9. Components simulated in the demo

Say on camera (or in the description) which parts are simulated locally. This
list matches what the code actually does in local development.

| Component                | Local simulation                                                                                                                                                                                                                                                                                         | Where it lives                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| SMS DLT gateway          | OTPs and notifications are handed to `DevStubOtpDeliveryProvider` / in-memory channel providers; no SMS is sent. Real sending requires the Exotel provider with DLT entity and template IDs via env credentials.                                                                                         | `apps/api/src/auth/provider.ts`, `packages/notifications/src/channels/exotel-sms.ts` |
| WhatsApp Business Cloud  | Same stub treatment; the Meta webhook receiver (`GET/POST /v1/delivery/webhooks/meta`) is mounted when `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` and `EXOTEL_RELAY_WEBHOOK_SECRET` are set.                                                                                                         | `apps/api/src/server-bootstrap.ts`, `apps/api/src/delivery-webhooks.ts`              |
| Payment partner webhooks | `POST /v1/reconciliation/webhooks/partner` accepts simulated UPI virtual account credit notifications. Requests must carry `X-Webhook-Timestamp` and `X-Webhook-Signature` (HMAC-SHA256 of `v1.<timestamp>.<body>` under `PARTNER_WEBHOOK_SECRET`); unsigned or tampered requests are rejected with 401. | `apps/api/src/app.ts` (`partnerWebhookRoute`)                                        |
| Virus scanner            | With `CLAMAV_HOST` set, uploads are scanned over ClamAV's INSTREAM protocol (`ClamAvVirusScannerAdapter`). Without it, uploads fail closed through `UnconfiguredVirusScannerAdapter`.                                                                                                                    | `apps/api/src/virus-scanner.ts`                                                      |
| Blockchain anchor        | The queue worker publishes Merkle roots to a `RootRegistry` contract through `ANCHOR_RPC_URL`. Locally that is Anvil; staging uses Polygon Amoy. Signing uses `ANCHOR_PRIVATE_KEY` with `ANCHOR_ALLOW_LOCAL_SIGNER=true` outside production, or KMS in production.                                       | `packages/queue/src/anchoring.ts`, `contracts/src/RootRegistry.sol`                  |
| Bank statement feed      | The reconciliation statement endpoint ingests CSV bank statements (`POST /v1/reconciliation/statements`) instead of a live bank API connection.                                                                                                                                                          | `apps/api/src/reconciliation/`                                                       |
| Redis                    | Started by docker compose but unused by application code; all durable state is PostgreSQL.                                                                                                                                                                                                               | `docker-compose.yml`                                                                 |

## 10. Shot list and pacing

| Order | Screen                                   | Route                                   | Length target |
| ----- | ---------------------------------------- | --------------------------------------- | ------------- |
| 1     | Demo reset output in terminal            | `pnpm demo:reset`                       | 10 s          |
| 2     | Public landing page                      | `/`                                     | 8 s           |
| 3     | Public fund view                         | `/funds/{fundId}`                       | 15 s          |
| 4     | Treasurer console                        | `/funds/{fundId}/treasurer`             | 12 s          |
| 5     | New expense form and review              | `/funds/{fundId}/expenses/new`          | 25 s          |
| 6     | Bill upload response (terminal)          | API call                                | 10 s          |
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
  repeat the section 4 sign-in steps, then re-record the affected journey only.
- The seeded pending expense `01940000-0000-7000-8000-000000000062` (25,000
  INR, battery packs) is a backup approval target if the Journey 1 retakes
  pile up: it starts every reset in `submitted` state with zero approvals.

## 11. Troubleshooting

| Symptom                                                    | Cause                                                                             | Fix                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Upload returns 503 "malware scanner is unavailable"        | No ClamAV daemon at `CLAMAV_HOST`                                                 | Start the daemon (section 6) or record without the upload step         |
| Upload returns 400 on a valid-looking file                 | Declared MIME type does not match the file magic bytes                            | Keep the original extension and pass `;type=image/jpeg` in curl        |
| `/v1/me` returns 401 with the seeded cookie                | The session is not a trusted device yet                                           | Run the `/v1/auth/pin/setup` call from section 4 for that persona      |
| PIN modal rejects the PIN                                  | PIN violates the rules in `apps/api/src/pin/rules.ts`                             | Use `482613` or another non-pattern six-digit PIN                      |
| Worker exits immediately with "Invalid worker environment" | Missing `DATABASE_URL`, or `ANCHOR_ALLOW_LOCAL_SIGNER` not `true` with no KMS key | Export the full env block from section 8                               |
| Verify page says "proof data is incomplete"                | No anchor has landed yet (worker not running or discovery job not fired)          | Wait for the 5-minute discovery tick or record the pending-state story |
| `demo:reset` fails with ECONNREFUSED                       | PostgreSQL is not running                                                         | `docker compose up -d` and retry                                       |
