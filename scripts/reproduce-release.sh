#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
ref="${1:?Usage: scripts/reproduce-release.sh <tag-or-sha> [output-dir]}"
output_dir="${2:-./rebuild}"
case "$output_dir" in
  /*) ;;
  *) output_dir="$PWD/$output_dir" ;;
esac

commit="$(git -C "$root" rev-parse "$ref^{commit}")"
if [[ "$ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  release_tag="$ref"
else
  release_tag="local-${commit:0:12}"
fi

temp="$(mktemp -d)"
worktree="$temp/worktree"
cleanup() {
  git -C "$root" worktree remove --force "$worktree" >/dev/null 2>&1 || true
  rm -rf "$temp"
}
trap cleanup EXIT

git -C "$root" worktree add --detach "$worktree" "$commit" >/dev/null
mkdir -p "$output_dir"
(
  cd "$worktree"
  YEN_RELEASE_TAG="$release_tag" bash scripts/repro-build.sh "$output_dir"
)

echo "Reproduced release from $commit in $output_dir"