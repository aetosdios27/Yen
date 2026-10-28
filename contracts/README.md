# RootRegistry

RootRegistry stores one immutable `bytes32` commitment per Yen publication.
It has no external contract dependencies, upgrade mechanism, payable entry points,
or functions to transfer funds. Native currency sent through ordinary calls is rejected.
The EVM can still force currency into any address; the registry cannot withdraw it.
Personal data and proof bundles stay off-chain.

The published value is the **wrapped global root** from
[`IntervalTree.root`](../packages/shared/src/merkle/README.md):

```text
SHA256(0x04 || u64be(fundCount) || merkleRoot(fundLeaves))
```

The contract treats that value as opaque. It cannot establish data availability,
off-chain truth, completeness, or correct computation of the commitment.

## Publication and authority

`publishRoot(bytes32 root, uint64 sequence)` requires the current `publisher`, a
nonzero root, and exactly the previous sequence plus one. The first sequence is 1.
Gapless numbering makes missing publication numbers detectable and allows retries
after failed transactions. It does not prescribe a wall-clock interval or prove
consistency between successive commitments. The same root can be published again
at a new sequence, for example when an interval has no changes.

`latestRoot()` returns the last commitment. `latestSequence()` returns its number.
`rootAt(sequence)` returns a historical commitment. Both root getters return zero
for unpublished sequences, including the reserved sequence 0. No valid publication
can be overwritten or deleted. Once sequence `uint64.max` is published, the
registry is full; the counter cannot wrap.

The single publisher also owns the right to transfer publication authority.
`proposePublisher(address)` nominates a nonzero successor different from the
current publisher. The nominee must call `acceptPublisher()`. Until acceptance,
the current publisher keeps all authority. A new proposal replaces the previous
one, without an expiry. Acceptance clears the pending proposal and revokes the old
publisher's authority. There is no separate owner, renunciation, or recovery role.

`RootPublished` indexes the sequence, root, and publishing address.
`PublisherTransferProposed` and `PublisherTransferred` expose authority changes.
All validation failures use custom errors; see the generated ABI for their fields.

## Reproduce the checks

Use Foundry **v1.5.0**, Solidity **0.8.30**, Paris EVM, and optimizer enabled with
200 runs. `foundry.toml` pins the compiler and settings. The Paris target avoids
requiring newer EVM opcodes. Tests use the committed forge-std source at
`8e40513d678f392f398620b3ef2b418648b33e89` (v1.11.0), including both upstream
licenses. See [`lib/forge-std/VENDORED.md`](lib/forge-std/VENDORED.md). There are no
submodules or `forge install` steps in CI.

From the repository root, install the frozen JavaScript dependencies and define
this container wrapper. `--entrypoint ''` bypasses the image's `sh -c` entry point;
the Podman user mapping and SELinux label permit access to this checkout.

```sh
pnpm install --frozen-lockfile
forge() {
  podman run --rm --userns=keep-id --entrypoint '' \
    -v "$PWD/contracts:/work:Z" -w /work \
    ghcr.io/foundry-rs/foundry:v1.5.0 forge "$@"
}
forge --version
forge fmt --check
forge build
forge test
forge test --match-contract RootRegistryInvariantTest
forge coverage --report summary --report lcov
node contracts/script/check-coverage.mjs
forge snapshot --check
node contracts/script/export-abi.mjs --check
pnpm check
pnpm --filter @yen/shared typecheck
pnpm --filter @yen/shared test
pnpm --filter @yen/shared build
```

Unit tests cover getters, constructor validation, all custom errors, events,
replays, skipped sequences, transfer replacement and acceptance, the uint64
boundary, and rejected native currency. Fuzz tests exercise roots, sequences, and
callers with 1,024 cases each. Three handler-based invariants run 256 campaigns of
128 calls each, interleaving valid publications and role transfers with rejected
unauthorized calls, rewrites, gaps, and zero roots. An independent history checks
every old root after each call. `fail_on_revert = true` makes unexpected handler
reverts fail the run. These randomized checks are not a formal proof.

CI requires 100% line **and** branch coverage for `src/RootRegistry.sol` using the
LCOV counts. Other test and script files do not dilute that threshold. The checker
fails if the contract record, counts, or nonzero coverage totals are missing.

To update gas expectations after reviewing a change, run `forge snapshot` and
commit `.gas-snapshot`. CI runs `forge snapshot --check`. To regenerate the typed
ABI, run `forge build` then `node contracts/script/export-abi.mjs`. The exporter
formats with the repository's pinned Biome dependency. CI compares the committed
[`abi.ts`](../packages/shared/src/registry/abi.ts) with the compiler artifact.
The module exports `rootRegistryAbi`, `RootRegistryAddress`, and a nullable
`rootRegistryAddress` placeholder through `@yen/shared`. It has no deployment address.

The Foundry CI job always runs and must succeed for `CI Gate`. It downloads
`foundry_v1.5.0_linux_amd64.tar.gz` directly from the
[Foundry v1.5.0 release](https://github.com/foundry-rs/foundry/releases/tag/v1.5.0).
The hard-coded SHA-256 below comes from the archive asset's published `digest` in
the [GitHub release metadata](https://api.github.com/repos/foundry-rs/foundry/releases/tags/v1.5.0).
CI verifies the archive before extracting or executing it. No Foundry action is used.

```text
5cd98f9092bcc28be087939491f786b2bf3ed55e492996a409e29519b8ab4dc8
```

## Check deployment locally

From the repository root, run:

```sh
bash contracts/script/test-deploy.sh
```

The check downloads Solidity 0.8.30 before starting Anvil on a private Podman
network. It rejects chain 31337, switches this disposable chain to 80002, and
broadcasts `Deploy.s.sol` using a throwaway key printed by Anvil. No public RPC
is contacted. The publisher comes from `ROOT_REGISTRY_PUBLISHER` and differs
from the deployment signer.

`write-manifest.mjs` verifies the mined receipt and canonical block, exact creation
and runtime bytecode, constructor publisher, and initial empty registry state.
It writes the documented manifest shape only after those checks pass. The local
manifest and logs stay under git-ignored `contracts/broadcast/local/`. A second
check supplies a different publisher and requires rejection without writing a file.
The containers and private network are removed on exit.

## Deploy and verify on Polygon Amoy

No deployment has been made. [`deployments/amoy.json`](deployments/amoy.json) is
explicitly a template, with null address, transaction hash, block, and publisher.
Its [JSON schema](deployments/amoy.schema.json) requires those values for a
`deployed` manifest. Do not treat the template as a usable deployment.

1. Copy `contracts/.env.example` to `contracts/.env`. Set `AMOY_RPC_URL`,
   `ROOT_REGISTRY_PUBLISHER`, and `ETHERSCAN_API_KEY` locally. The publisher can
   differ from the deployment signer. Check the publisher address independently;
   it receives immediate authority at construction.
2. Fund a dedicated deployment account with test POL on **Amoy, chain 80002**.
   Confirm the network against the
   [Polygon Amoy documentation](https://docs.polygon.technology/tools/dApp-development/common-tools/remix/).
3. From the repo root, enter the pinned container. The `.env`, `.keystores`, and
   broadcast output paths are git-ignored. Never commit credentials or pass a
   private key in command-line arguments.

   ```sh
   podman run --rm -it --userns=keep-id --entrypoint /bin/sh \
     --env-file contracts/.env \
     -v "$PWD/contracts:/work:Z" -w /work \
     ghcr.io/foundry-rs/foundry:v1.5.0
   ```

4. Inside the container, import the signer into an encrypted keystore. Enter the
   key and a keystore password at the prompts. Check the RPC's chain ID and build.

   ```sh
   cast wallet import amoy-deployer --keystore-dir .keystores --interactive
   cast chain-id --rpc-url "$AMOY_RPC_URL"
   forge build
   ```

5. Dry-run the deployment. Foundry resolves `amoy` from `AMOY_RPC_URL`.
   `Deploy.run()` reads `ROOT_REGISTRY_PUBLISHER` and rejects any chain other
   than 80002. Inspect the simulated result
   and constructor argument before broadcasting.

   ```sh
   forge script script/Deploy.s.sol:Deploy \
     --rpc-url amoy --chain 80002 --keystore .keystores/amoy-deployer
   ```

6. Broadcast and verify using the same compiler settings and constructor argument.
   The script uses the CLI signer through `startBroadcast()`; it reads no key from
   the environment. Etherscan V2 uses an Etherscan API key for the Amoy explorer.

   ```sh
   forge script script/Deploy.s.sol:Deploy \
     --rpc-url amoy --chain 80002 --keystore .keystores/amoy-deployer \
     --broadcast --verify \
     --verifier-url 'https://api.etherscan.io/v2/api?chainid=80002' \
     --etherscan-api-key "$ETHERSCAN_API_KEY"
   ```

   If broadcasting succeeded but verification failed, do not redeploy. Set
   `REGISTRY_ADDRESS` to the actual receipt's contract address, then verify it:

   ```sh
   forge verify-contract "$REGISTRY_ADDRESS" src/RootRegistry.sol:RootRegistry \
     --chain 80002 --watch \
     --constructor-args "$(cast abi-encode 'constructor(address)' "$ROOT_REGISTRY_PUBLISHER")" \
     --verifier-url 'https://api.etherscan.io/v2/api?chainid=80002' \
     --etherscan-api-key "$ETHERSCAN_API_KEY"
   ```

7. Inspect `broadcast/Deploy.s.sol/80002/run-latest.json` and retrieve the receipt
   independently. Check receipt status, contract address, block number, bytecode,
   publisher, empty sequence, and source verification on
   [Amoy Polygonscan](https://amoy.polygonscan.com/).

   ```sh
   cast receipt "$DEPLOYMENT_TX_HASH" --rpc-url "$AMOY_RPC_URL"
   cast code "$REGISTRY_ADDRESS" --rpc-url "$AMOY_RPC_URL"
   cast call "$REGISTRY_ADDRESS" 'publisher()(address)' --rpc-url "$AMOY_RPC_URL"
   cast call "$REGISTRY_ADDRESS" 'latestSequence()(uint64)' --rpc-url "$AMOY_RPC_URL"
   cast call "$REGISTRY_ADDRESS" 'latestRoot()(bytes32)' --rpc-url "$AMOY_RPC_URL"
   ```

8. Exit the container. From the repository root, export `AMOY_RPC_URL` and
   `ROOT_REGISTRY_PUBLISHER` in your local shell and generate a candidate manifest:

   ```sh
   node contracts/script/write-manifest.mjs \
     contracts/broadcast/Deploy.s.sol/80002/run-latest.json \
     contracts/deployments/amoy.candidate.json
   ```

   The command checks chain ID 80002, the successful canonical receipt, build
   bytecode, publisher, and empty registry state at the deployment block. A failed
   check writes nothing. Review the candidate against `amoy.schema.json` and the
   explorer verification, then replace `amoy.json` through a reviewed PR. Keep
   local Anvil manifests under `broadcast/`. Resolve the shared address from the
   verified Amoy manifest when integrating the application.

If a broadcast is interrupted, check its transaction hash and receipt before any
retry. Creating another contract is a new deployment with separate empty history.

## Prior art

- [Ethereum attack and defense](../docs/REFERENCES.md#ethereum-reorg) illustrates reorg and finality risks; Polygon has its own consensus and testnets may reset.
- [OpenTimestamps](../docs/REFERENCES.md#opentimestamps) illustrates independent timestamp verification; Yen uses an authorized Polygon registry and a different proof format.
- [RFC 9162](../docs/REFERENCES.md#rfc-9162) describes log monitoring and conflicting views; the registry alone cannot prove off-chain completeness.
- [RFC 6962](../docs/REFERENCES.md#rfc-6962) informs the underlying tree; Yen publishes nested, size-committing roots rather than certificate-tree heads.
