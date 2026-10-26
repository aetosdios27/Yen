# YEN-16 local verification

Verified on 2026-10-26 in worktree `t3-f5ffd7c3`, branch
`aetosdios27/yen-16-rootregistry-contract`. No push or Amoy transaction was made.
Foundry ran through `ghcr.io/foundry-rs/foundry:v1.5.0` with Solidity 0.8.30,
Paris EVM, and 200 optimizer runs.

## Contract checks

`forge fmt --check`, `forge build`, `forge test`,
`forge coverage --report summary --report lcov`, and `forge snapshot --check`
all exited successfully. The existing committed `.gas-snapshot` matches and did
not need regeneration. Build lint notes concern modifier inlining, a test
immutable's name, and casts bounded by the invariant campaign depth.

Actual RootRegistry coverage output:

```text
File                 Lines            Statements      Branches       Functions
src/RootRegistry.sol  100.00% (29/29)  100.00% (31/31)  100.00% (8/8)  100.00% (7/7)
```

The suite passed 22 tests: 14 unit tests, five fuzz tests configured for 1,024
cases, and three invariants. Each invariant completed 256 campaigns of 128 calls
(32,768 calls), with zero handler reverts. Two fuzz tests reported 1,025 runs;
all passed.

`node contracts/script/check-coverage.mjs` printed:

```text
RootRegistry coverage: lines 29/29, branches 8/8
```

Deliberately reducing LCOV branch hits to 7 made the checker exit 1 with
`lines 29/29, branches 7/8`. Restoring the report made it pass.

## Local deployment

`bash contracts/script/test-deploy.sh` passed using Anvil in an internal Podman
network with only a loopback RPC port. The compiler was downloaded before
isolation. The signing key came from this disposable Anvil instance's printed
test accounts. The script rejected chain 31337 with `WrongChain(31337 ...)`
before broadcasting, then deployed successfully after setting the local chain
ID to 80002.

These values describe **only the disposable local Anvil deployment**:

```text
address:         0x5fbdb2315678afecb367f032d93f642f64180aa3
transactionHash: 0x328b295d6921708b08bd29d54cb15e7acfe7d719226aad94aa2e747691c5877c
blockNumber:     1
publisher:       0x000000000000000000000000000000000000bEEF
signer:          0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

The manifest writer independently fetched the successful receipt, canonical
block, creation transaction, runtime bytecode, publisher, and zero initial
sequence, root, and pending publisher. It wrote
`broadcast/local/manifest.json`. Supplying another publisher failed with
`Creation bytecode or constructor publisher differs from the build` and wrote
no output file. Containers and the private network were removed.

The local manifest and untouched `deployments/amoy.json` template both passed
the committed Draft 2020-12 JSON Schema using Python's `jsonschema` validator.
Invalid deployed addresses, transaction hashes, block numbers, publishers, and
chain IDs were rejected. The Amoy template still has null deployment fields.

## ABI, CI, and JavaScript

The manifest writer now validates environment variables, the broadcast and
artifact files, all six JSON-RPC reply shapes, and its output with Zod before
using their fields. `node --test contracts/script/*.test.mjs` passed 25 cases,
including a valid manifest and malformed input and RPC failures that each report
one line without a stack trace. The Foundry CI job runs these tests after build.
`contracts/package.json` resolves Zod from the pnpm workspace without adding
Turbo scripts. The local Anvil deployment check passed again with the validated
writer, including the wrong-chain and wrong-publisher rejections.

`pnpm install --frozen-lockfile`, `pnpm check`, the three `@yen/shared` commands,
and `pnpm turbo run typecheck test build --filter="...[origin/main]"` passed.
The filtered Turbo run executed three shared-package tasks and no contracts
tasks. Shared tests passed 142 tests in eight files. The pinned Podman Foundry
`forge fmt --check`, `forge build`, and `forge test` passed; Foundry ran 22 tests.

ABI regeneration succeeded. `export-abi.mjs --check` passed, then exited 1 with
`Stale ABI` after deliberately changing `publishRoot` to `publishRootDrift`.
It passed again after restoring the file. The built `@yen/shared` entry point
exports the ABI and null address placeholder.

The Foundry v1.5.0 Linux amd64 archive and official release metadata were both
downloaded with `curl`. The metadata's asset `digest`, hard-coded CI checksum,
and downloaded archive's SHA-256 all matched:

```text
5cd98f9092bcc28be087939491f786b2bf3ed55e492996a409e29519b8ab4dc8
```

The official release metadata is
`https://api.github.com/repos/foundry-rs/foundry/releases/tags/v1.5.0`.
The release publishes this checksum as the archive asset's SHA-256 digest;
there is no separate checksum-list asset. CI checks it before extraction or
execution and uses no Foundry action. Its checkout, pnpm, and Node actions use
the same full commit SHAs as the existing jobs. Foundry has only `contents: read`
permission and no path filter or job condition.

PyYAML parsed the workflow. The actual CI Gate shell was exercised locally for
pull-request, push, and merge-group results: successful Foundry passed, while
failed, cancelled, and skipped Foundry were rejected. Foundry is unconditional,
including when `contracts/` is untouched. No hosted Actions run was triggered.

From the worktree root, the following passed:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @yen/shared typecheck
pnpm --filter @yen/shared test
pnpm --filter @yen/shared build
```

Shared tests passed 142 tests in eight files. Biome reported only the existing
configuration deprecation info. The three shared commands must run separately:
`pnpm --filter @yen/shared typecheck test build` passes `test build` as arguments
to TypeScript and is not a sequence of scripts.

## Remaining human work

Choose and independently check the real publisher and deployment signer, fund
the signer with test POL, and authorize the documented Amoy deployment and
explorer verification. No Amoy address or source verification is claimed here.
The parent owns pushing and reviewing the resulting hosted CI run.
