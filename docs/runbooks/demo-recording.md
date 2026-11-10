# Demo Recording Runbook

Step-by-step recording sequence for the Yen demo video. Everything in this
runbook is verified against the seed script (`packages/db/src/dev-seed.ts`),
the API routes (`apps/api/src/contract.ts`, `apps/api/src/public-expense-contract.ts`)
and the web router (`apps/web/src/app`). A developer who has never touched the
repo should be able to reproduce every screen below without asking questions.

## 1. Prerequisites

| Requirement | Version / value | Notes |
| --- | --- | --- |
| Node.js | 24.21.0 | pinned in `package.json` engines |
| pnpm | 12.6.0 | enabled through corepack |
| Docker (or Podman) compose | any current | runs PostgreSQL 16 and Redis 7 from `docker-compose.yml` |
| ClamAV daemon | any with INSTREAM on TCP | required only for the bill-upload step; see section 4 |

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

| Persona | Role | Phone (E.164) | Locale | Mock session token |
| --- | --- | --- | --- | --- |
| Aarav Sharma | treasurer | +919876543210 | en | `yen_mock_session_treasurer_token` |
| Priya Verma | approver | +919876543211 | en | `yen_mock_session_approver1_token` |
| Rohan Iyer | approver | +919876543212 | hi | `yen_mock_session_approver2_token` |
| Ananya Sen | member (donor) | +919876543213 | en | `yen_mock_session_donor1_token` |
| Vikram Malhotra | member (donor) | +919876543214 | en | `yen_mock_session_donor2_token` |
| Sunita Rao | member (donor) | +919876543215 | hi | `yen_mock_session_donor3_token` |

Seeded donations (all verified against bank transactions in the seed):

| Donor | Amount | UTR |
| --- | --- | --- |
| Ananya Sen | 2,00,000 INR | 123456789012 |
| Vikram Malhotra | 2,00,000 INR | 123456789013 |
| Sunita Rao | 1,00,000 INR | 123456789014 |

Ledger balance after the seeded paid expense: 4,65,000.00 INR, zero-sum
verified, 23 chained audit events.

Seeded expenses:

| Expense | Amount | Status | Description |
| --- | --- | --- | --- |
| `01940000-0000-7000-8000-000000000061` | 75,000 INR | approved | High-torque brushless motor set and ESCs, evidence `motors_invoice.pdf` |
| `01940000-0000-7000-8000-000000000062` | 25,000 INR | submitted (pending approval) | LiPo battery packs and safety charging station |
| `01940000-0000-7000-8000-000000000063` | 35,000 INR | paid | RoboCup Asia Pacific 2026 Team Registration Fee, UTR 987654321001 |

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


