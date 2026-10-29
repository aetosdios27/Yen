#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:?Usage: prepare-release-assets.sh ARTIFACT_DIR RELEASE_TAG [SBOM_FILE]}"
release_tag="${2:?Usage: prepare-release-assets.sh ARTIFACT_DIR RELEASE_TAG [SBOM_FILE]}"
sbom_file="${3:-}"
if [[ -n "$sbom_file" ]]; then
  if [[ "$sbom_file" != "$artifact_dir/sbom.cdx.json" ]]; then
    cp "$sbom_file" "$artifact_dir/sbom.cdx.json"
  fi
fi
archive="$artifact_dir/yen-${release_tag}.tar"
test -s "$archive"
if [[ ! -f "$artifact_dir/sbom.cdx.json" ]]; then
  echo "SBOM file missing: $artifact_dir/sbom.cdx.json" >&2
  exit 1
fi
(cd "$artifact_dir" && sha256sum "yen-${release_tag}.tar" sbom.cdx.json > SHA256SUMS)
node scripts/verify-release "$archive" "$artifact_dir/SHA256SUMS" local-rehearsal
node scripts/test-tampered-artifact.mjs "$archive" "$artifact_dir/SHA256SUMS" local-rehearsal
