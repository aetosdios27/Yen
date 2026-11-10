#!/usr/bin/env bash
set -euo pipefail

tool_dir="$(mktemp -d)"
trap 'rm -rf "$tool_dir"' EXIT
archive="$tool_dir/actionlint.tar.gz"
curl --fail --location --silent --show-error --retry 3 \
  https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz \
  --output "$archive"
# Verified against actionlint_1.7.12_checksums.txt in the upstream v1.7.12 release.
printf '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8  %s\n' "$archive" | sha256sum --check --strict
tar -xzf "$archive" -C "$tool_dir" actionlint
shopt -s nullglob
"$tool_dir/actionlint" -color .github/workflows/*.yml .github/workflows/*.yaml
