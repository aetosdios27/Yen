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
