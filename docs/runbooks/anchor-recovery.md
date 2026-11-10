# Anchoring stall recovery (Ethereum and Polygon)

Use this runbook when anchors stop landing on chain: the reconciliation loop
raises `anchor_missing` (events unanchored for at least one hour), the publisher
wallet runs low on funds, a pending anchor transaction stays unmined, or a gas
price spike pushes replacements past the configured fee ceiling. The anchoring
worker lives in `packages/queue` (`src/anchoring.ts`); it currently targets the
Polygon Amoy testnet through the `RootRegistry` contract, and the same
procedures apply to any Ethereum-style chain.

Severity: anchoring lag beyond the 60-minute objective in
[../slo.md](../slo.md) is SEV-2 while the money path still works. Anchoring is a
verifiability control, not the ledger itself, so a stall does not block
donations or payouts. It becomes SEV-1 only when verification of fund data is
also in doubt (see the divergence scenario in
[incident-response.md](incident-response.md)).

## How anchoring works, in short

- A pg-boss cron job (`blockchain-anchoring-discovery`, every 5 minutes) enqueues
  one anchoring job per active fund; `blockchain-anchoring` jobs are singleton
  per fund, so a stuck job blocks that fund's queue, not other funds.
- Each anchor row records `from_seq`, `to_seq`, `root`, `chain_sequence`,
  `status` (`submitted`, `confirmed`, `failed`), and `tx_hash`.
- Publishing uses EIP-1559 transactions with initial fees of 50 gwei
  `maxFeePerGas` and 1 gwei `maxPriorityFeePerGas`.
- A transaction that stays pending for more than 10 minutes is replaced on the
  same nonce with fees bumped by one eighth (`fee * 9 / 8`). Replacements stop
  at a hard ceiling of 100 gwei `maxFeePerGas` and 2 gwei
  `maxPriorityFeePerGas` and then throw "Stuck anchor reached the configured fee
  ceiling; operator action required".
- A submitted anchor confirms only after 12 blocks beyond the receipt block.
- A separate cron job (`blockchain-anchoring-reconcile`, every 5 minutes)
  raises `anchor.wallet_low` below 0.05 native token, `anchor_missing` after one
  hour without a confirmed anchor, and `anchor_mismatch` when a stored root does
  not match the chain.

## First diagnosis

1. Identify what is stalled. The anchors table shows state per fund:

   ```sh
   psql "$DATABASE_URL" -c "SELECT fund_id, chain_sequence, status, tx_hash, created_at FROM anchors ORDER BY created_at DESC LIMIT 20;"
   ```

2. Check the worker is alive and anchoring is configured. Anchoring starts only
   when both `ANCHOR_RPC_URL` and `ROOT_REGISTRY_ADDRESS` are set; with the
   variables unset the worker runs everything else and silently never anchors:

   ```sh
   docker compose logs --tail 100 worker | grep -i anchor
   ```

3. Check the publisher wallet balance on the target chain. The worker raises
   `anchor.wallet_low` below 0.05 native token; a drained wallet produces
   stuck-or-never-submitted transactions:

   ```sh
   cast balance <publisher-address> --rpc-url "$ANCHOR_RPC_URL"
   ```

4. For each `submitted` anchor with a `tx_hash`, look the transaction up on the
   chain explorer (Amoy: polygonscan) or by RPC. Classify:
   - Receipt `success` but anchor still `submitted`: confirmation is only a
     matter of the 12-block check; wait one reconciliation cycle before acting.
   - Receipt `pending`: nonce is stuck; go to the pending transaction scenario.
   - Receipt `failed`: the row moves to `failed` and pg-boss retries with
     exponential backoff; go to the failed transaction scenario.
   - Transaction absent from the chain (`getTransaction` throws): the RPC dropped
     it or it never broadcast; the worker runs `recoverPublishedAnchor` on its
     own, and repeated absence means an RPC problem; go to the RPC scenario.

## Scenario: publisher wallet empty

1. Confirm the alert: `anchor.wallet_low` or repeated "transaction underpriced"
   or "insufficient funds" errors in worker logs.
2. Fund the publisher address with native token (POL on Amoy comes from a
   faucet). The publisher address is derived from the signer
   (`ANCHOR_KMS_KEY_ID`, or the local dev signer from `ANCHOR_PRIVATE_KEY`);
   never move funds to a different address than the one the signer controls.
3. Anchoring resumes on the next discovery cycle (every 5 minutes). Confirm the
   next anchor reaches `confirmed`:

   ```sh
   psql "$DATABASE_URL" -c "SELECT fund_id, chain_sequence, status, confirmed_at FROM anchors ORDER BY created_at DESC LIMIT 5;"
   ```

4. If the wallet drains repeatedly, record the drain rate in the incident and
   budget a funding schedule; a recurring empty wallet is an alerting gap, not
   just an operational one.

## Scenario: stuck nonce (pending transaction never mines)

The worker replaces a pending transaction automatically after 10 minutes,
reusing the nonce and raising fees by one eighth. Intervene only when the
automatic replacement stopped, which happens at the fee ceiling.

1. Find the stuck transaction: `submitted` anchor older than 10 minutes with a
   receipt that stays `pending`. Read its nonce and fees:

   ```sh
   cast tx <tx-hash> --rpc-url "$ANCHOR_RPC_URL"
   ```

2. Check the current network gas price. If the network needs more than the
   ceiling (100 gwei max fee, 2 gwei priority), the automatic replacement throws
   "Stuck anchor reached the configured fee ceiling; operator action required"
   on every retry and pg-boss keeps retrying with backoff.
3. Decide with the incident owner:
   - Wait out the spike: pending transactions are not lost; once the network
     price falls below the pending transaction's fees, it mines. The singleton
     job for that fund waits, other funds keep anchoring. This is the default
     answer; the anchor objective tolerates one hour of lag.
   - Replace manually above the ceiling: send a replacement transaction with the
     same nonce and the same `publishRoot(root, sequence)` calldata, at a fee
     you explicitly approve. Record the fee, the reason, and the approver in the
     incident thread. Never change the root or the sequence in a manual
     replacement; the row in `anchors` is the source of truth for what must be
     published:

     ```sh
     cast calldata "publishRoot(bytes32,uint256)" <root> <sequence>
     cast mktx --rpc-url "$ANCHOR_RPC_URL" \
       --from <publisher-address> \
       --to "$ROOT_REGISTRY_ADDRESS" \
       --nonce <stuck-nonce> \
       --gas-price <approved-fee> \
       <calldata-from-above>
     cast publish <signed-transaction-from-mktx> --rpc-url "$ANCHOR_RPC_URL"
     ```

     In a KMS deployment the operator cannot reconstruct the signature locally;
     instead run the replacement through a temporary worker started with an
     elevated `ANCHOR_MAX_FEE_PER_GAS` configuration if one is introduced, or
     coordinate a code change. Never export the KMS key material to sign
     manually; that is a break-glass violation.
4. After the replacement mines, the worker stores the new `tx_hash` on the
   anchor row and confirmation proceeds after 12 blocks. Verify the row flips to
   `confirmed` and `anchor_missing` stops re-raising (the alert deduplicates per
   fund, but check the alert events table).
5. If the stuck nonce belongs to a transaction that will never mine (for
   example a dropped transaction from an RPC outage), and the anchor row has no
   usable `tx_hash`, reset the anchor row's `status` to `failed` with the
   incident owner's approval so the worker republishes cleanly. Resetting status
   metadata is allowed; editing `root`, `from_seq`, `to_seq`, or event data is
   not (see [break-glass.md](break-glass.md)).

## Scenario: gas price spike above the ceiling

1. Confirm from worker logs: repeated "Stuck anchor reached the configured fee
   ceiling; operator action required".
2. Anchoring stops paying above the ceiling by design. The money path keeps
   working; events accumulate unanchored. Confirm the SLO impact: anchor lag
   samples go bad after 60 minutes per fund.
3. Check whether the spike is transient (a mint, an airdrop, an exploit) or
   sustained. For a transient spike, wait and monitor; for a sustained one,
   treat the fee configuration change as a small, reviewed code change with the
   pilot lead's approval, never an ad hoc environment hack; the ceiling lives in
   `packages/queue/src/anchoring.ts` as code, deliberately not environment
   tunable.
4. After prices normalize, confirm the backlog drains: discovery re-enqueues
   every fund every 5 minutes, and the per-fund singleton jobs serialize. Watch
   the `anchors` table until every fund's `chain_sequence` catches up with its
   unanchored event sequences.

## Scenario: RPC outage or wrong chain view

1. Symptoms: `getReceipt` and `getTransaction` calls fail or return absent for
   transactions that the explorer shows; `anchor_mismatch` alerts; reconciliation
   logs RPC failures.
2. Check the RPC endpoint health directly:

   ```sh
   curl -sS -X POST "$ANCHOR_RPC_URL" -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
   ```

3. Compare the returned block number with the public explorer. A stale public
   RPC can show an old chain view, which makes confirmed anchors look missing
   and can trigger false `anchor_mismatch` alerts. Switch `ANCHOR_RPC_URL` to a
   healthy provider (the repository default for Amoy is
   `https://rpc-amoy.polygon.technology/`) and restart the worker.
4. After the RPC recovers, verify no anchor was mis-marked: every `failed` row
   from the outage window must be checked against the explorer before the next
   publish; a row that actually mined should be re-confirmed by the
   reconciliation loop rather than republished. Republishing an already-published
   `chain_sequence` fails safely with "Anchor sequence is already occupied by a
   different on-chain root".

## After recovery

1. Run the verifier against the chain to confirm published roots match
   recomputed roots for a recent bundle:

   ```sh
   pnpm --filter @yen/verifier exec yen-verify <bundle.json> --rpc "$ANCHOR_RPC_URL" --contract "$ROOT_REGISTRY_ADDRESS"
   ```

2. Confirm the anchor lag objective recovers on the next sampling cycle
   ([../slo.md](../slo.md), `anchor_lag`).
3. Record the stall duration, cause, and any manual fees in the incident thread;
   SEV-2 stalls longer than one day get a short post-mortem note.
