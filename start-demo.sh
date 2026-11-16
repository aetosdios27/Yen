#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ "${1:-}" == "--help" ]]; then
  echo 'Usage: ./start-demo.sh [--no-chain]'
  echo 'Starts the local demo and restores the three demo PINs without deleting financial data.'
  echo 'Requires Node from .nvmrc, pnpm, and Docker/Podman or local PostgreSQL.'
  exit 0
fi
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--no-chain" ) ]]; then
  echo 'Usage: ./start-demo.sh [--no-chain]' >&2
  exit 1
fi
if [[ -n "${NODE_ENV:-}" && "$NODE_ENV" != development ]]; then
  echo 'Refusing demo startup outside development.' >&2
  exit 1
fi
command -v node >/dev/null || { echo 'Install Node from .nvmrc first.' >&2; exit 1; }
command -v pnpm >/dev/null || { echo 'Install pnpm from package.json first.' >&2; exit 1; }
if [[ "$(node --version)" != "v$(cat .nvmrc)" ]]; then
  echo "Use Node $(cat .nvmrc), then run this script again." >&2
  exit 1
fi
export NODE_ENV=development
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:pw@localhost:5432/postgres}"
export WEB_PORT="${WEB_PORT:-3000}"
export API_PORT="${API_PORT:-3001}"
export NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}"
# Refuse occupied ports before restoring credentials or starting a second stack.
node --input-type=module <<'JS'
import { createServer } from 'node:net';
const url = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Demo requires a loopback PostgreSQL database');
if (process.env.WEB_PORT === process.env.API_PORT) throw Error('Web and API ports must differ');
for (const value of [process.env.WEB_PORT, process.env.API_PORT]) {
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw Error('Invalid demo port');
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(value), resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
JS
# Compose uses fixed container names; reuse their project across Git worktrees.
for engine in docker podman; do
  if command -v "$engine" >/dev/null && "$engine" compose version >/dev/null 2>&1; then
    if existing_project=$("$engine" inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' yen-postgres 2>/dev/null); then
      if [[ -n "$existing_project" && "$existing_project" != '<no value>' ]]; then
        export COMPOSE_PROJECT_NAME="$existing_project"
      fi
    fi
    break
  fi
done
pnpm install --frozen-lockfile
pnpm turbo run build --filter='@yen/api^...' --filter=@yen/api-client
exec pnpm dev:full --demo "$@"
