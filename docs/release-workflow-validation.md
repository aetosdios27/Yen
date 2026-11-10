# YEN-68 workflow validity follow-up

Audit base: `9534a88` (contains `45e26c3`, PR #152). This follow-up preserves
existing build, signing and publishing behavior and fixes the invalid workflow.

| Criterion / scope                                                         | Main status                               | Evidence and remaining work                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned toolchain, locked dependencies, deterministic API/verifier archive | Implemented                               | `.nvmrc`, `package.json`, `scripts/repro-build.sh`; prior audit in `release-supply-chain-audit.md`                                                                                          |
| Two clean builds on different machines                                    | Blocked by invalid workflow               | `release.yml` already has independent-build and digest comparison before signing; real tag run still required                                                                               |
| Signed provenance and Cosign signatures                                   | Blocked by invalid workflow               | Separate sign job, minimal permissions, pinned installers; first tag must exercise them                                                                                                     |
| Public running digest and provenance links                                | Implemented; deployment evidence external | `apps/api/src/build-info.test.ts`: reports verified deployment archive digest; `apps/web/src/app/about/build/page.test.tsx`: shows current API build information and matching release links |
| Documented rebuild and digest comparison                                  | Met                                       | `scripts/reproduce-release.sh`, `docs/verify-release.md`                                                                                                                                    |
| Artifacts and ABI share commit identity                                   | Met in code                               | `.github/scripts/release-manifest.test.mjs`: release manifest binds the packaged ABI to the checked-out commit; operator must deploy that archive                                           |
| Tampered artifact rejected                                                | Met                                       | `scripts/test-tampered-artifact.mjs`, called by asset preparation and PR rehearsal                                                                                                          |
| Cited guidance and honest SLSA claim                                      | Met                                       | `docs/REFERENCES.md`, `docs/verify-release.md`; no SLSA Build Level claimed                                                                                                                 |
| Only allowed actions or checksum-pinned downloads                         | Gap: stale allow-list                     | Dynamic exact-set test in `supply-chain.test.mjs`; pinned actionlint download and governance tests                                                                                          |
| Workflow validation gates merges                                          | Gap                                       | New checksum-verified actionlint step in Verify, required by CI Gate                                                                                                                        |

## Reproduction and fix

Actionlint v1.7.12 Linux amd64 SHA-256:
`8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`,
verified against the upstream release's `actionlint_1.7.12_checksums.txt`.
It reported four errors in `release.yml`, at original lines 22, 85, 133 and 187:
`context "runner" is not allowed here`. All other workflows had no findings,
including `nightly-chaos.yml`, which is untouched. No false positives suppressed.

Each release job now writes `ARTIFACT_DIR=$RUNNER_TEMP/yen-release` to
`GITHUB_ENV` in its first step. Existing step-level `runner.temp` inputs remain
valid. GitHub's [context availability table](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability)
was opened and read: `jobs.<job_id>.env` permits neither `runner` nor `env`;
step `env`, `run` and `with` permit both.

Run `bash .github/scripts/lint-workflows.sh` on Linux amd64 to reproduce the CI
check. It verifies the archive before extraction and checks every `.yml` and
`.yaml` workflow. Governance tests require that check in Verify, its dependency
in CI Gate, and exact agreement between explicitly allowed external actions and
those used by all workflows. GitHub-owned `actions/` and `github/` actions remain
covered by `github_owned_allowed=true`.

## Operator action after merge

An administrator must run `.github/scripts/apply-repo-settings.sh` by hand to
apply the reduced allow-list. This PR does not change live repository settings.

No tag or release is created by this work. Release jobs themselves remain
unexecuted until the operator pushes a tag. On the first real release:

1. Confirm both build jobs finish and **Require independent archive digest to
   match before signing** passes `cmp` and all `sha256sum` checks.
2. Confirm **Attest release files** produces GitHub provenance for the archive,
   SBOM and checksum file, with the expected repository, tag and source commit;
   verify with the documented `gh attestation verify` command.
3. Confirm **Create keyless signatures** produces all three Cosign bundles and
   verify each using the documented workflow identity and GitHub OIDC issuer.
4. Confirm the published assets include those files, rebuild and compare the
   archive digest, then deploy the verified archive with its digest configured.
   Check `/version` and `/about/build` against the release commit, digest and
   provenance links.
