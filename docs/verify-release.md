# Verify a release

Yen's version-tag workflow publishes a deterministic build archive, a CycloneDX
SBOM, SHA-256 checksums, GitHub build-provenance attestations and Cosign keyless
signature bundles. The workflow builds the API and web app twice in separate
clean worktrees before publishing the archive.

Before the first tag after this change merges, a repository administrator must
apply the updated Actions allow-list with
`.github/scripts/apply-repo-settings.sh aetosdios27/Yen`. It adds the pinned
Anchore SBOM and Sigstore Cosign installer actions used by the release workflow.

## Download and check the release

Install GitHub CLI, then download the release assets for a version tag:

```sh
tag=v1.2.3
gh release download "$tag" --repo aetosdios27/Yen
```

Check the archive and SBOM checksums:

```sh
sha256sum --check SHA256SUMS
```

Verify GitHub's build provenance for the archive:

```sh
gh attestation verify "yen-${tag}.tar" --repo aetosdios27/Yen
```

The release also includes a Sigstore bundle for each checksum, SBOM and archive.
Verify the archive signature with the exact release workflow identity and
GitHub's OIDC issuer:

```sh
cosign verify-blob \
  --bundle "yen-${tag}.tar.sigstore.json" \
  --certificate-identity "https://github.com/aetosdios27/Yen/.github/workflows/release.yml@refs/tags/${tag}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "yen-${tag}.tar"
```

To verify the other signed release files, use the matching bundle and file:

```sh
cosign verify-blob \
  --bundle sbom.cdx.json.sigstore.json \
  --certificate-identity "https://github.com/aetosdios27/Yen/.github/workflows/release.yml@refs/tags/${tag}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  sbom.cdx.json

cosign verify-blob \
  --bundle SHA256SUMS.sigstore.json \
  --certificate-identity "https://github.com/aetosdios27/Yen/.github/workflows/release.yml@refs/tags/${tag}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  SHA256SUMS
```

## Rebuild the archive

Use Node `24.21.0`, pnpm `12.6.0`, GNU tar, and a Linux x86-64 environment.
The repository pins Node in `.nvmrc` and pnpm in the root `packageManager`
field. Check out the release tag into a clean checkout, then run:

```sh
git checkout --detach "$tag"
pnpm install --frozen-lockfile
YEN_RELEASE_TAG="$tag" bash scripts/repro-build.sh ./rebuild
cmp "yen-${tag}.tar" "./rebuild/yen-${tag}.tar"
```

The script builds each app in two clean Git worktrees, sets the timezone, locale
and `SOURCE_DATE_EPOCH`, excludes Next.js' disposable cache and timing traces,
normalizes Next.js' source-root metadata, creates a normalized tar archive and
fails if the two SHA-256 digests differ. The archive contains `apps/api/dist`,
the committed API OpenAPI document and `apps/web/.next`.

Next.js normally writes random preview keys and a server action encryption key
into its output. The web build derives these values from the Git tree so two
builds of the same source have identical manifests. The current web app does
not use Draft Mode or Server Actions; the build fails if a Server Action appears.
Do not treat these deterministic build keys as secrets. If the app adds Draft
Mode or Server Actions, revisit this scheme before releasing it. Next's timing
traces and cache are intentionally left out of the release archive because
they contain host-specific or time-dependent data and are not runtime files.

## What these checks establish

- `SHA256SUMS` detects accidental or malicious changes to the listed files,
  provided the checksum file itself is trusted.
- `gh attestation verify` checks that GitHub recorded provenance for the
  artifact digest and the Yen GitHub Actions workflow.
- `cosign verify-blob` checks the signature, transparency-log inclusion and
  expected GitHub Actions identity for the exact file bytes.
- A matching local archive shows that the selected source revision produced
  the same packaged build outputs under the stated toolchain and environment.

## What they do not establish

- They do not prove that the source code is safe, correct or free of malicious
  dependencies, or that the SBOM is complete beyond what Syft detects.
- Provenance records GitHub's account of the build. These checks do not prove
  that GitHub, its hosted runner, the repository configuration or the workflow
  was uncompromised, and Yen does not claim a SLSA level from this setup.
- The two builds run on one host. A matching digest is not an independent
  rebuild and does not establish reproducibility across operating systems,
  CPU architectures or future runner images. The release job pins Ubuntu
  24.04 and the Node and pnpm versions; system libraries and the full runner
  image are not content-addressed here.
- The archive is a build output, not proof of what a separate deployment host
  is serving. The API `/version` endpoint reports the commit and Git tree ID
  embedded during the API build; an operator can still replace the running
  service or its response.
- The SBOM records dependencies found by Syft from the source checkout and
  lockfile. Its generation timestamp can differ between releases and it is not
  part of the reproducibility archive.
