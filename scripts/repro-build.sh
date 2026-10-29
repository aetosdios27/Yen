#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
expected_node="$(cat "$root/.nvmrc")"
actual_node="$(node --version | sed 's/^v//')"
expected_pnpm="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).packageManager.split("@").at(-1))' "$root/package.json")"
actual_pnpm="$(pnpm --version)"

if [[ "$actual_node" != "$expected_node" ]]; then
  printf 'Expected Node %s, found %s\n' "$expected_node" "$actual_node" >&2
  exit 1
fi
if [[ "$actual_pnpm" != "$expected_pnpm" ]]; then
  printf 'Expected pnpm %s, found %s\n' "$expected_pnpm" "$actual_pnpm" >&2
  exit 1
fi
if [[ -n "$(git -C "$root" status --porcelain)" ]]; then
  echo "Run the reproducibility check from a clean checkout; it builds HEAD." >&2
  exit 1
fi

source_commit="$(git -C "$root" rev-parse HEAD)"
source_tree="$(git -C "$root" rev-parse 'HEAD^{tree}')"
source_date_epoch="$(git -C "$root" show -s --format=%ct "$source_commit")"
release_tag="${YEN_RELEASE_TAG:-local-${source_commit:0:12}}"
if [[ ! "$release_tag" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "YEN_RELEASE_TAG contains unsupported characters." >&2
  exit 1
fi

temp="$(mktemp -d)"
worktree_one="$temp/one"
worktree_two="$temp/two"
cleanup() {
  git -C "$root" worktree remove --force "$worktree_one" >/dev/null 2>&1 || true
  git -C "$root" worktree remove --force "$worktree_two" >/dev/null 2>&1 || true
  rm -rf "$temp"
}
trap cleanup EXIT

git -C "$root" worktree add --detach "$worktree_one" "$source_commit" >/dev/null
git -C "$root" worktree add --detach "$worktree_two" "$source_commit" >/dev/null

build_once() {
  local directory="$1"
  local artifact="$2"
  (
    cd "$directory"
    export TZ=UTC
    export LC_ALL=C
    export SOURCE_DATE_EPOCH="$source_date_epoch"
    export YEN_BUILD_SHA="$source_commit"
    export YEN_BUILD_ID="$source_tree"
    export NEXT_TELEMETRY_DISABLED=1
    export TURBO_CACHE_DIR="$directory/.turbo"
    pnpm install --frozen-lockfile
    pnpm turbo run build --filter=@yen/api --filter=@yen/web
    tar --sort=name --mtime="@${source_date_epoch}" --owner=0 --group=0 --numeric-owner \
      --exclude=apps/web/.next/cache -cf "$artifact" \
      apps/api/dist apps/api/openapi/openapi.json apps/web/.next
  )
}

artifact_name="yen-${release_tag}.tar"
artifact_one="$temp/one.tar"
artifact_two="$temp/two.tar"
build_once "$worktree_one" "$artifact_one"
build_once "$worktree_two" "$artifact_two"

hash_one="$(sha256sum "$artifact_one" | cut -d ' ' -f1)"
hash_two="$(sha256sum "$artifact_two" | cut -d ' ' -f1)"
printf 'First build:  %s  %s\n' "$hash_one" "$artifact_name"
printf 'Second build: %s  %s\n' "$hash_two" "$artifact_name"
if [[ "$hash_one" != "$hash_two" ]]; then
  echo "Build artifacts differ." >&2
  exit 1
fi

if [[ -n "${1:-}" ]]; then
  mkdir -p "$1"
  cp "$artifact_one" "$1/$artifact_name"
  printf '%s  %s\n' "$hash_one" "$artifact_name" > "$1/SHA256SUMS"
fi
