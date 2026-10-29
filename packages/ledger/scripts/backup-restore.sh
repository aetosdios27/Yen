#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d)"
source_db="yen_source_$RANDOM"
target_db="yen_restore_$RANDOM"
container="yen-backup-restore-$RANDOM"
if [[ -n "${YEN_RESTORE_ADMIN_URL:-}" ]]; then
  admin_url="$YEN_RESTORE_ADMIN_URL"
  source_url="${admin_url%/*}/$source_db"
  target_url="${admin_url%/*}/$target_db"
  cleanup() {
    dropdb --if-exists --maintenance-db="$admin_url" "$target_db" >/dev/null 2>&1 || true
    dropdb --if-exists --maintenance-db="$admin_url" "$source_db" >/dev/null 2>&1 || true
    rm -rf "$tmpdir"
  }
  trap cleanup EXIT
  createdb --maintenance-db="$admin_url" "$source_db"
  createdb --maintenance-db="$admin_url" "$target_db"
else
  port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
  cleanup() { podman rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$tmpdir"; }
  trap cleanup EXIT
  podman run -d --name "$container" -e POSTGRES_PASSWORD=yen -e POSTGRES_DB=postgres -p "127.0.0.1:$port:5432" postgres:16 >/dev/null
  for _ in $(seq 1 60); do
    podman exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1 && break
    sleep 1
  done
  admin_url="postgres://postgres:yen@127.0.0.1:$port/postgres"
  source_url="postgres://postgres:yen@127.0.0.1:$port/$source_db"
  target_url="postgres://postgres:yen@127.0.0.1:$port/$target_db"
  podman exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $source_db" -c "CREATE DATABASE $target_db"
fi
DATABASE_URL="$source_url" pnpm --filter @yen/db migrate
FUND_ID_FILE="$tmpdir/fund-id" DATABASE_URL="$source_url" node --input-type=module <<'JS'
import { createSql, uuidv7 } from '@yen/db';
import { initLedgerSchema } from './dist/schema.js';
import { paise } from '@yen/shared';
import { recordDonation } from '@yen/ledger';
const sql = createSql(process.env.DATABASE_URL);
await initLedgerSchema(sql);
const user = uuidv7(), org = uuidv7(), fund = uuidv7();
await sql`INSERT INTO users (id, phone, display_name) VALUES (${user}, '+19999999999', 'Backup drill')`;
await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${org}, 'Backup drill', 'individual', ${user})`;
await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fund}, ${org}, 'Backup drill', '{}')`;
await sql.begin((tx) => recordDonation(tx, { fundId: fund, amount: paise(12345) }));
await sql.end();
await import('node:fs/promises').then(({writeFile}) => writeFile(process.env.FUND_ID_FILE, fund));
JS
if [[ -n "${YEN_RESTORE_ADMIN_URL:-}" ]]; then
  pg_dump --format=custom --dbname="$source_url" > "$tmpdir/yen.dump"
  restore_started_ns="$(date +%s%N)"
  pg_restore --dbname="$target_url" --exit-on-error < "$tmpdir/yen.dump"
else
  podman exec "$container" pg_dump -U postgres --format=custom --dbname="$source_db" > "$tmpdir/yen.dump"
  restore_started_ns="$(date +%s%N)"
  podman exec -i "$container" pg_restore -U postgres --dbname="$target_db" --exit-on-error < "$tmpdir/yen.dump"
fi
restore_elapsed_ms="$(( ($(date +%s%N) - restore_started_ns) / 1000000 ))"
printf 'Restore measured: %s ms; archive bytes: %s\n' "$restore_elapsed_ms" "$(wc -c < "$tmpdir/yen.dump" | tr -d ' ')"
YEN_TEST_DATABASE_URL="$target_url" YEN_RESTORE_FUND_ID="$(cat "$tmpdir/fund-id")" node scripts/verify-restored.mjs
