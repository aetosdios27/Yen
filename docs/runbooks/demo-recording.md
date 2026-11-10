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
