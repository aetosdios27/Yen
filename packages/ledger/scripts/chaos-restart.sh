#!/usr/bin/env bash
set -euo pipefail
: "${YEN_TEST_DATABASE_URL:?Set YEN_TEST_DATABASE_URL to the isolated Postgres database}"
: "${YEN_CHAOS_CONTAINER:?Set YEN_CHAOS_CONTAINER to the disposable Postgres container name}"
export YEN_CHAOS_CONTAINER
pnpm chaos:restart
