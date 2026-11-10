# YEN-68 release supply-chain audit

Audited main `a23b499` and the changes in this PR. No release tag was created,
no deployment changed, no issue closed, and no Dependabot branch modified.

| Criterion on main                                         | Finding                                        | Resolution / evidence                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned toolchain, locked dependencies, normalized outputs | Partial                                        | `.nvmrc`, `packageManager`, frozen install and normalized tar already exist. `scripts/repro-build.sh` now separates HOME/TMPDIR, forces compilation and checks embedded metadata.                                                                                                                                |
| Two different machines                                    | Gap                                            | Main compares two worktrees on one runner. Release now adds `independent-build` and gates signing on identical archive checksums. A successful real tag run remains required evidence. Local checks are one physical host only.                                                                                  |
| Signed provenance for release assets                      | Implemented, never exercised by a real release | Existing separate sign job attests archive, SBOM and checksum file and creates Cosign bundles. Cosign installer v3 cannot install the configured Cosign v3; pin installer v4.1.3.                                                                                                                                |
| Public version, digest, provenance                        | Partial                                        | Existing `/version` and `/about/build` show identity and provenance links. Turbo previously stripped release inputs; now they survive strict mode. Runtime `YEN_ARTIFACT_DIGEST` lets the operator supply the verified archive digest without a self-referential build. Actual deployment remains operator work. |
| Rebuild and compare command                               | Met                                            | `scripts/reproduce-release.sh`, `pnpm repro:build`, `docs/verify-release.md` and documented `cmp`. Provenance URL and public API URL are fixed for portable release archives.                                                                                                                                    |
| Artifacts and ABI share deployed commit                   | Gap                                            | Archive now includes verifier, generated ABI and `release.json` with commit/tree/tag and ABI checksum. API embeds the same source commit. Deployment must use that archive.                                                                                                                                      |
| Tamper rejection                                          | Met                                            | `scripts/test-tampered-artifact.mjs` flips a byte and requires digest mismatch; asset preparation runs it. It verifies checksums, not signature trust.                                                                                                                                                           |
| Supply-chain guidance and honest level                    | Met                                            | `docs/REFERENCES.md` cites SLSA v1.2 and Reproducible Builds. No SLSA Build Level is claimed; no real release/provenance pair exists to assess.                                                                                                                                                                  |

## Workflow audit

All six workflow files (`ci`, `codeql`, `release`, `load-test`,
`nightly-chaos`, `nightly-invariants`) use full 40-character action SHAs.
GitHub-owned actions are allowed; external action owners match the repository
allow-list in `.github/scripts/apply-repo-settings.sh`.
`.github/scripts/supply-chain.test.mjs` checks every workflow on future changes.

The only direct tool download on main is Foundry v1.5.0 in `ci.yml`, checked
against SHA-256 `5cd98f9092bcc28be087939491f786b2bf3ed55e492996a409e29519b8ab4dc8`
before extraction. The pinned SBOM action's transitive Syft installer was fetched
without a checksum. Release now directly downloads Syft v1.42.1, verifies asset
SHA-256 `989ded4e772810f93de6ccdc4512f79a6dabb5fb2dd2a9ffc72a80c955e6125a`
and only then executes it. That digest was read from the upstream GitHub release
asset metadata. Cosign installer v4.1.3 boots exactly the requested v3.1.4;
its pinned action checks the Linux amd64 binary against
`424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa`.

This audit covers workflow commands and the release tool installers. It does
not claim every network request inside every allow-listed action was traced:
Node/pnpm setup, CodeQL and gitleaks remain trusted pinned actions. Nor are the
hosted runner image or Postgres service image content-addressed here. Repository
administrator application of the allow-list still needs confirmation.

## Dependabot decisions (no merges)

| PR                                         | Decision for current release.yml                                                     | Upstream changes and effect                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #148 Cosign installer 3.10.1 → 4.1.3       | Safe to merge; this PR incorporates the same pin to fix the existing incompatibility | v4 supports Cosign v3's bundle format. Existing `sign-blob --bundle` commands already conform; explicit `cosign-release: v3.1.4` matches v4.1.3's checksum-pinned bootstrap.                                                                                                                                                                  |
| #139 attest-build-provenance 3.0.0 → 4.2.2 | Safe to merge                                                                        | v4 is a compatibility wrapper around `actions/attest`; `subject-path` still passes through, and its nested action is SHA pinned. Current contents/id-token/attestations permissions suffice for provenance. No migration to a new action name is required.                                                                                    |
| #143 upload-artifact 4.6.2 → 7.0.2         | Safe to merge for existing zipped multi-file uploads                                 | Node 24 requires runner ≥2.327.1; Ubuntu hosted runners qualify. v7 adds optional direct single-file uploads. `archive` defaults true, so named zipped uploads remain compatible with current download v4 and proposed v8. Do not set `archive: false` for these multi-file globs.                                                            |
| #145 download-artifact 4.1.8 → 8.0.2       | Safe to merge                                                                        | Node 24 runner requirement as above. v5 adjusted extraction when downloading one artifact by ID; Yen downloads by name. v8 supports both zipped and direct artifacts, uses ESM internally, and errors on digest mismatch by default. Keep that default. It accepts existing upload v4 zipped archives and proposed upload v7 zipped archives. |

These are source/release-note compatibility assessments, not successful release
rehearsals of each proposed pair. Upgrade upload/download together if switching
to direct uploads; the existing workflow does not request that feature.

Sources opened and read:

- [Cosign installer v4.0.0](https://github.com/sigstore/cosign-installer/releases/tag/v4.0.0), [v4.1.3](https://github.com/sigstore/cosign-installer/releases/tag/v4.1.3), and its SHA-pinned action.yml.
- [Attest v4.0.0](https://github.com/actions/attest-build-provenance/releases/tag/v4.0.0), [v4.2.2](https://github.com/actions/attest-build-provenance/releases/tag/v4.2.2), and the wrapper's action.yml.
- [Upload v5](https://github.com/actions/upload-artifact/releases/tag/v5.0.0), [v6](https://github.com/actions/upload-artifact/releases/tag/v6.0.0), [v7](https://github.com/actions/upload-artifact/releases/tag/v7.0.0), [v7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2), and action.yml's archive default.
- [Download v5](https://github.com/actions/download-artifact/releases/tag/v5.0.0), [v6](https://github.com/actions/download-artifact/releases/tag/v6.0.0), [v7](https://github.com/actions/download-artifact/releases/tag/v7.0.0), [v8](https://github.com/actions/download-artifact/releases/tag/v8.0.0), [v8.0.2](https://github.com/actions/download-artifact/releases/tag/v8.0.2), and README compatibility guidance.
- [Pinned SBOM installer source](https://github.com/anchore/sbom-action/blob/66cbf4bc1f1c0d2edc94016e65bc221b6bb0ad6c/src/github/SyftGithubAction.ts), [Syft release](https://github.com/anchore/syft/releases/tag/v1.42.1).

## Validation

Regression tests demonstrate runtime digest reporting and rejection of malformed
values, strict-environment metadata retention, independent-runner signing gate,
ABI commit/checksum binding, and checksum verification of Syft. The new tests
failed before their respective changes and passed afterwards. Local raw logs,
rebuild digests and decision history are retained in the owner's YEN-68 trail;
these are not substitutes for a real signed release run and deployed-page check.
