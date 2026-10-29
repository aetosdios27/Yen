# Trust claims

Each public guarantee Yen makes, the exact wording, where it appears, the code and test that back it, and its status. `.github/scripts/check-trust-claims.mjs` checks the links in this file. It does not check that the wording matches the cited text.

## Status

- **enforced:** A mechanism exists in code and at least one named test fails when that mechanism is removed. The row records the mutation run.
- **partial:** Some mechanism exists, but a stated part of the claim is not built, or no test fails without it. `Missing` says what.
- **planned:** The mechanism is not built. The row names the missing parts.

Statuses describe the repository at this commit. An `enforced` row can still depend on an unbuilt part, and its `Mechanism` line names that scope.

Each README claim that has a row carries a `<!-- claim: CLAIM-ID -->` marker. The check fails when a marker has no row here.

## Claims

### CLAIM-01 Donor verification and treasurer limits

- **Status:** planned
- **Wording:** "Donors verify every rupee. Treasurers cannot quietly spend it."
- **Where:** README.md:8
- **Mechanism:** none
- **Test:** none
- **Reference:** none yet (gap)
- **Missing:** No donation intake, expense approval, donor verifier, or bank feed exists. The claim needs CLAIM-09, CLAIM-12, CLAIM-13, CLAIM-14, and CLAIM-15.

### CLAIM-02 Yen holds no money

- **Status:** partial
- **Wording:** "Yen **never holds money**."
- **Where:** README.md:33
- **Mechanism:** `contracts/src/RootRegistry.sol` has no payable entry point, receive, or fallback. No application code moves money.
- **Test:** `contracts/test/RootRegistry.t.sol` "testRejectsNativeCurrencyAndUnknownCalls"
- **Reference:** none yet (gap)
- **Missing:** The test covers only RootRegistry. No test or CI check stops money-moving code from being added to the application, and no bank integration exists yet. The EVM can still force currency into the registry address, as `contracts/README.md` says.

### CLAIM-03 Changes and deletions of recorded events are detected

- **Status:** partial
- **Wording:** "Any change or deletion of a recorded event would be detected"
- **Where:** README.md:66; README.md:51; README.md:33
- **Mechanism:** `packages/eventlog/src/chain.ts` `verifyChainStream`, `scanChainStructureStream`
- **Test:** `packages/eventlog/src/eventlog.test.ts` "detects a changed field at that event or its successor"; `packages/eventlog/src/eventlog.test.ts` "detects removal, reordering, duplication, and insertion"
- **Reference:** `schneier-kelsey`, `crosby-wallach`
- **Missing:** No event table, database append path, or trigger exists (YEN-18). Nothing stores a recorded event, so there is no live record to detect a change in. Verification needs an externally authenticated head, and no code publishes or reads one (CLAIM-10).

### CLAIM-04 Each event links to the hash of the event before it

- **Status:** enforced
- **Wording:** "Later `prev_hash` values equal the preceding event's `hash`."
- **Where:** packages/eventlog/README.md:3
- **Mechanism:** `packages/eventlog/src/chain.ts` `makeNextEvent`, `scanChainStructureStream`
- **Test:** `packages/eventlog/src/eventlog.test.ts` "rejects an event whose own hash is valid but that links to the wrong predecessor"
- **Reference:** `schneier-kelsey`
- **Mutation:** Removed the `prev_hash` comparison in `scanChainStructureStream`. At first no test failed, which showed the link check was untested. A test was added in the same change. With the comparison removed it fails, and with it restored all 56 eventlog tests pass.
- **Missing:** Nothing for this claim in the library. Whether stored events keep the link depends on database persistence, which CLAIM-03 tracks.

### CLAIM-05 Verifiers reject other funds and report the first break

- **Status:** enforced
- **Wording:** "Both verifiers reject events from another fund and return the first break with its `index`, `seq`, and reason."
- **Where:** packages/eventlog/README.md:40
- **Mechanism:** `packages/eventlog/src/chain.ts` `scanChainStructureStream`, `verifyChainStream`
- **Test:** `packages/eventlog/src/eventlog.test.ts` "binds integrity results and observed structure to the fund"; `packages/eventlog/src/eventlog.test.ts` "reports first-break reasons and verifies async streams"
- **Reference:** `crosby-wallach`
- **Mutation:** Removed the expected-head fund check in `scanChainStructureStream`. "binds integrity results and observed structure to the fund" failed.

### CLAIM-06 A verified result means the complete chain matches the authenticated head

- **Status:** enforced
- **Wording:** "`ok: true` means the complete chain matches that head and includes `verifiedAgainst: ChainHead`."
- **Where:** packages/eventlog/README.md:40
- **Mechanism:** `packages/eventlog/src/chain.ts` `verifyChainStream`. Structure checks return no `ok` field, so they cannot produce this result.
- **Test:** `packages/eventlog/src/eventlog.test.ts` "requires an authenticated head for complete array and stream verification"; `packages/eventlog/src/eventlog.test.ts` "cannot treat a structure result as a verified result"
- **Reference:** `cox-tlog`
- **Mutation:** Removed the truncation comparison (`count < authenticated.count`) in `verifyChainStream`. "requires an authenticated head for complete array and stream verification" failed.

### CLAIM-07 Event hashes are domain-separated SHA-256 over canonical JSON

- **Status:** enforced
- **Wording:** "`hash = SHA-256(UTF-8("yen/eventlog/event/v1\\0") || UTF-8(RFC8785(envelope without hash)))`."
- **Where:** packages/eventlog/README.md:5
- **Mechanism:** `packages/eventlog/src/chain.ts` `computeEventHash`; `packages/eventlog/src/canonical.ts` `canonicalize`
- **Test:** `packages/eventlog/src/eventlog.test.ts` "pins every v1 event, canonical string, and hash"; `packages/eventlog/src/eventlog.test.ts` "hashes only an exact unsigned event envelope"
- **Reference:** `rfc-8785`, `rfc-6234`
- **Mutation:** Dropped the domain prefix from the SHA-256 call in `computeEventHash`. "pins every v1 event, canonical string, and hash" failed, along with other hash tests.

### CLAIM-08 Two-level Merkle proofs detect tampering against the global root

- **Status:** enforced
- **Wording:** "Assuming SHA-256 collision resistance, any change would be detected when the committed event data is checked against that root."
- **Where:** packages/shared/src/merkle/README.md:6
- **Mechanism:** `packages/shared/src/merkle/interval.ts` `verifyEventProof`. Library scope only: the expected root must come from an authenticated source, which no code yet provides (CLAIM-10).
- **Test:** `packages/shared/src/merkle/properties.test.ts` "two-level proofs reject single-bit salt, event hash, latest hash and root tampering or another fund"
- **Reference:** `rfc-6962`, `rfc-6234`
- **Mutation:** Replaced the global-root comparison in `verifyEventProof` with `true`. The property test failed.

### CLAIM-09 Anyone can verify proofs in the browser

- **Status:** partial
- **Wording:** "Anyone can verify proofs locally in the browser."
- **Where:** README.md:52
- **Mechanism:** `packages/shared/src/merkle/interval.ts` `verifyEventProof`, bundled for `platform: "browser"`
- **Test:** `packages/shared/src/merkle-browser.test.ts` "bundles for platform=browser and runs the same nested verifier in Node and the browser bundle"
- **Reference:** `cox-tlog`
- **Missing:** `apps/web` is a placeholder with no verify page and no public fund view. The test runs the verifier inside a restricted VM, not in a visitor's browser. No authenticated root is published to check against (CLAIM-10).

### CLAIM-10 Root hashes are published to a public chain

- **Status:** planned
- **Wording:** "Periodic root hashes are published to the Polygon Amoy testnet without names or amounts."
- **Where:** README.md:52
- **Mechanism:** none in use. `contracts/src/RootRegistry.sol` `publishRoot` exists but no code calls it.
- **Test:** none
- **Reference:** `ethereum-reorg`, `opentimestamps`
- **Missing:** No anchoring worker, publication schedule, or batching exists. No Amoy deployment exists: `contracts/deployments/amoy.json` is a template with null fields. Nothing authenticates a root for verifiers to use.

### CLAIM-11 Personal data stays off the chain

- **Status:** partial
- **Wording:** "Personal data stays off the chain"
- **Where:** README.md:69
- **Mechanism:** `contracts/src/RootRegistry.sol` `publishRoot` accepts only a `bytes32` root. `packages/eventlog/src/model.ts` `parseEvent` rejects unknown payload fields and raw user IDs.
- **Test:** `packages/eventlog/src/eventlog.test.ts` "rejects a raw user UUID as actor and unversioned payload additions"
- **Reference:** `dpdp-act`, `ico-pseudonymisation`
- **Missing:** No chain writer exists (CLAIM-10), so nothing is published yet. Payload schemas are provisional (packages/eventlog/README.md:9-36). No test scans a published artifact for personal data. Pseudonymisation alone does not make data anonymous. Real names and phone numbers are stored outside the log. Per-fund pseudonyms (#28) and private 9-digit Yen ID storage (#30) are planned protections in separate, unmerged PRs (YEN-46, YEN-70); this branch does not provide them.

### CLAIM-12 Spending needs the configured approvals

- **Status:** planned
- **Wording:** "Spending needs the approvals the club configured"
- **Where:** README.md:67; README.md:49
- **Mechanism:** none
- **Test:** none
- **Reference:** `owasp-transaction`, `nist-800-63b`, `owasp-auth`
- **Missing:** For MVP, money actions are confirmed with a 6-digit Yen PIN, and approvals are recorded by Yen after PIN confirmation (attested by the server, not signed by the approver's device; YEN-25). A compromised server could record an approval nobody gave; the event log stops later edits but not write-time fabricated approvals. Before Yen ever moves money, device-signed approvals via WebAuthn (YEN-71) must be required. No expense, approval, quorum, or PIN verification code exists in the repository. The event types `expense.approved` and `expense.rejected` are provisional schemas only. The bearer scheme does not authenticate tokens (apps/api/README.md:29). Named tests to be written: `apps/api/src/approvals.test.ts` "records approval only after valid 6-digit PIN confirmation bound to action", `apps/api/src/approvals.test.ts` "requires configured quorum of distinct approvers before spending transitions", and `apps/api/src/approvals.test.ts` "distinguishes server-attested PIN confirmations from device-signed WebAuthn assertions".

### CLAIM-13 A payment is recorded only when the bank reports it

- **Status:** planned
- **Wording:** "The bank feed confirms incoming payments, so a payment is recorded only when the bank reports it."
- **Where:** README.md:48
- **Mechanism:** none
- **Test:** none
- **Reference:** `stripe-ledger`
- **Missing:** No bank feed integration or donation intake exists. `donation.verified` is a provisional event schema only.

### CLAIM-14 Unmatched debits are flagged publicly

- **Status:** planned
- **Wording:** "Any debit without a matching approval is flagged publicly."
- **Where:** README.md:50; README.md:68
- **Mechanism:** none
- **Test:** none
- **Reference:** `stripe-ledger`
- **Missing:** No bank integration, reconciliation, discrepancy workflow, or public flag view exists. `discrepancy.raised` is a provisional event schema only.

### CLAIM-15 Donors can object within a window

- **Status:** planned
- **Wording:** "donors receive an objection window"
- **Where:** README.md:49
- **Mechanism:** none
- **Test:** none
- **Reference:** none yet (gap)
- **Missing:** No objection code or window length exists. `expense.objection_raised` and `expense.objection_resolved` are provisional event schemas only.

### CLAIM-16 Money is integer paise, never floats

- **Status:** partial
- **Wording:** "Money is always **integer paise** with the branded `Paise` type, never floats."
- **Where:** README.md:113
- **Mechanism:** `packages/shared/src/paise.ts` `paise`, which rejects values that are not safe integers
- **Test:** `packages/shared/src/paise.test.ts` "adds without producing floats"
- **Reference:** `fowler-money`, `square-money`
- **Missing:** `Paise` is a TypeScript brand. The runtime check runs only where `paise()` or `paiseWire` parse a value. No lint rule or test blocks a float amount elsewhere. Ledger and bank amounts are not built.

### CLAIM-17 Money on the wire is a canonical decimal string

- **Status:** enforced
- **Wording:** "Every money field is a **canonical nonnegative decimal string of integer paise**."
- **Where:** apps/api/README.md:33
- **Mechanism:** `packages/shared/src/paise-wire.ts` `paiseWire`, used by `apps/api/src/contract.ts` `fundFields`
- **Test:** `packages/shared/src/paise-wire.test.ts` "rejects noncanonical paise %s"; `packages/shared/src/paise-wire.test.ts` "preserves paise %s exactly"
- **Reference:** `square-money`
- **Mutation:** Loosened the regex to `/^[0-9]+$/`. "rejects noncanonical paise %s" failed for `01`.

### CLAIM-18 Denied fund requests fail without revealing the fund

- **Status:** enforced
- **Wording:** "Denied reads return `404 not_found` so a caller cannot learn whether a fund exists."
- **Where:** apps/api/README.md:24
- **Mechanism:** `apps/api/src/app.ts` `authorizedFund`. Applies to the stub fund routes only. Real role checks (YEN-26) are not built.
- **Test:** `apps/api/src/app.test.ts` "conceals an existing fund when read policy denies it"; `apps/api/src/app.test.ts` "denies every documented funds route with the default policy"
- **Reference:** `owasp-api`
- **Mutation:** Changed the read denial in `authorizedFund` to `forbidden`. "conceals an existing fund when read policy denies it" failed.

### CLAIM-19 Unknown errors return a fixed message

- **Status:** enforced
- **Wording:** "Unknown exceptions return the fixed internal error message, with no stack or cause."
- **Where:** apps/api/README.md:60
- **Mechanism:** `apps/api/src/app.ts` `onError` fallback to `new ApiError("internal")`
- **Test:** `apps/api/src/app.test.ts` "hides unknown error messages, causes, and stacks"
- **Reference:** none yet (gap)
- **Mutation:** Added `String(error)` to the error body in `onError`. "hides unknown error messages, causes, and stacks" failed.

### CLAIM-20 Logs hold only allow-listed metadata

- **Status:** enforced
- **Wording:** "No raw URL, query, body, header, principal, phone number, authorization, cookie, or idempotency key is logged."
- **Where:** apps/api/README.md:133; apps/api/README.md:138
- **Mechanism:** `apps/api/src/logging.ts` `serializeRequestLog` parses each entry with a Zod schema, which drops unknown fields
- **Test:** `apps/api/src/app.test.ts` "logs only allowed metadata, using a route template and no raw inputs"; `apps/api/src/app.test.ts` "strips unexpected properties before JSON serialization"
- **Reference:** none yet (gap)
- **Mutation:** Replaced the parse in `serializeRequestLog` with `JSON.stringify(entry)`. "strips unexpected properties before JSON serialization" and "never logs sensitive error contents or unexpected failure fields" failed.

### CLAIM-21 Idempotent retries replay or conflict

- **Status:** partial
- **Wording:** "Changed input or a concurrent duplicate returns `409 idempotency_conflict`."
- **Where:** apps/api/README.md:89
- **Mechanism:** `apps/api/src/middleware.ts` `idempotency`, using the `IdempotencyStore` interface in `apps/api/src/stores.ts`
- **Test:** `apps/api/src/app.test.ts` "conflicts when a key is reused for a changed body"; `apps/api/src/app.test.ts` "rejects concurrent duplicates before both can execute"; `apps/api/src/app.test.ts` "replays the full response without executing the handler twice"
- **Reference:** `ietf-idempotency`, `stripe-idempotency`
- **Missing:** The default store is in memory and per process. The Postgres adapter is not built (YEN-18, YEN-24). A released or expired key can run again (apps/api/README.md:115-116). The IETF draft is work in progress, and Yen does not claim conformance to it.

### CLAIM-22 Rate limits return 429 with integer seconds

- **Status:** partial
- **Wording:** "A rejected request returns `429` with integer seconds in `retry-after`."
- **Where:** apps/api/README.md:123
- **Mechanism:** `apps/api/src/middleware.ts` `rateLimit`
- **Test:** `apps/api/src/app.test.ts` "limits per %s and refills using the injected clock"
- **Reference:** `rfc-6585`, `stripe-rate-limiters`
- **Missing:** Buckets are in memory and per process. Production needs a shared store for consistent limits across processes (apps/api/README.md:131).

### CLAIM-23 Direct pushes to main are blocked and changes need CI and an automated review

- **Status:** partial
- **Wording:** "Direct pushes to `main` are blocked. Every change needs passing CI checks and a perfect Greptile review."
- **Where:** README.md:143
- **Mechanism:** `.github/rulesets/main.json`
- **Test:** `.github/scripts/governance.test.mjs` "main merges on CI and Greptile, with stale approvals dismissed and threads resolved"; `.github/scripts/governance.test.mjs` "nobody can bypass the main ruleset"
- **Reference:** none yet (gap)
- **Missing:** No human approval is required to merge; the gate is CI plus the Greptile 5/5 check. The tests read the JSON file in this repository. They do not query GitHub, so CI cannot show that the ruleset is live. An admin applies it with `.github/scripts/apply-repo-settings.sh`, which runs outside CI.

### CLAIM-24 Applied migrations are immutable

- **Status:** enforced
- **Wording:** "Applied files are immutable. An edited checksum, missing file, renamed file, version gap, duplicate version, or out-of-order history fails the run."
- **Where:** packages/db/README.md:61
- **Mechanism:** `packages/db/src/migrate.ts` `migrate`, which compares each applied file's checksum with its history row
- **Test:** `packages/db/src/migrate.test.ts` "rejects an edited applied file and names it"; `packages/db/src/migrate.test.ts` "rejects removal or renaming of an applied file"; `packages/db/src/migrate.test.ts` "rejects missing or duplicate versions: %s"; `packages/db/src/migrate.test.ts` "rejects an out-of-order applied history"
- **Reference:** none yet (gap)
- **Mutation:** Disabled the checksum comparison in `migrate`. "rejects an edited applied file and names it" failed.

### CLAIM-25 Published roots are gapless and cannot be overwritten

- **Status:** enforced
- **Wording:** "No valid publication can be overwritten or deleted."
- **Where:** contracts/README.md:30; contracts/README.md:21
- **Mechanism:** `contracts/src/RootRegistry.sol` `publishRoot` requires `sequence == latestSequence + 1`. The contract has no delete function.
- **Test:** `contracts/test/RootRegistry.t.sol` "testReplayAndOverwriteAreRejected"; `contracts/test/RootRegistry.t.sol` "testSequenceCannotWrap"; `contracts/test/RootRegistry.invariant.t.sol` "invariantEveryPastRootIsImmutable"
- **Reference:** `cox-tlog`
- **Mutation:** Disabled the sequence check in `publishRoot`. "testReplayAndOverwriteAreRejected" failed.

### CLAIM-26 Publisher authority moves only on acceptance

- **Status:** enforced
- **Wording:** "`proposePublisher(address)` nominates a nonzero successor different from the current publisher. The nominee must call `acceptPublisher()`."
- **Where:** contracts/README.md:35
- **Mechanism:** `contracts/src/RootRegistry.sol` `onlyPublisher`, `acceptPublisher`
- **Test:** `contracts/test/RootRegistry.t.sol` "testFuzzUnauthorizedPublisher"; `contracts/test/RootRegistry.t.sol` "testFuzzUnauthorizedAcceptance"; `contracts/test/RootRegistry.t.sol` "testAcceptEmitsClearsProposalAndTransfersAllAuthority"
- **Reference:** none yet (gap)
- **Mutation:** Disabled the `onlyPublisher` check: "testFuzzUnauthorizedPublisher" failed. Disabled the caller check in `acceptPublisher`: "testFuzzUnauthorizedAcceptance" failed.

### CLAIM-27 The registry rejects native currency

- **Status:** enforced
- **Wording:** "Native currency sent through ordinary calls is rejected."
- **Where:** contracts/README.md:5
- **Mechanism:** `contracts/src/RootRegistry.sol` has no `receive` or `fallback`, so calls that send value revert. Forced sends are not covered, as `contracts/README.md` states.
- **Test:** `contracts/test/RootRegistry.t.sol` "testRejectsNativeCurrencyAndUnknownCalls"
- **Reference:** none yet (gap)
- **Mutation:** Added `receive() external payable {}`. "testRejectsNativeCurrencyAndUnknownCalls" failed.


### CLAIM-28 Per-fund pseudonyms isolate identity across funds

- **Status:** planned
- **Wording:** "PII belongs only in application tables. `pseudonyms` is an erasable mapping from a public UUID to a user."
- **Where:** packages/db/README.md:15
- **Mechanism:** none in use. The `ensureFundPseudonym` helper is planned under YEN-70 in `@yen/db` to map `(user_id, fund_id)` pairs to distinct random UUIDv4 pseudonyms.
- **Test:** none
- **Reference:** `ico-pseudonymisation`, `dpdpa-transcription`
- **Missing:** The per-fund pseudonym schema (`fund_pseudonyms`) and `ensureFundPseudonym` helper are not merged on this branch (developed on origin/aetosdios27/yen-70-fund-pseudonyms). Event persistence is unbuilt (YEN-18). Named tests to be written: `packages/db/src/pseudonyms.test.ts` "isolates pseudonyms for the same user across distinct funds", `packages/db/src/pseudonyms.test.ts` "generates random UUIDs without shared timestamp prefixes", and `packages/db/src/pseudonyms.test.ts` "converges idempotently under concurrent creation".

### CLAIM-29 Real names and Yen IDs stay outside event logs and public pages

- **Status:** partial
- **Wording:** "Names, phone numbers, VPAs, free-form notes, and raw evidence are not accepted."
- **Where:** packages/eventlog/README.md:9
- **Mechanism:** `packages/eventlog/src/model.ts` `parseEvent` rejects raw user UUIDs and unversioned payload fields. Private 9-digit Yen ID storage and exclusion from logs and public pages are planned under YEN-70 (#30, unmerged).
- **Test:** `packages/eventlog/src/eventlog.test.ts` "rejects a raw user UUID as actor and unversioned payload additions"
- **Reference:** `dpdp-act`, `dpdpa-transcription`
- **Missing:** The parse check covers the eventlog package only. Real names and phone numbers are stored in application tables; private 9-digit Yen ID storage is planned in separate, unmerged PR #30; UI donor visibility options (full name, initials, "a donor") and redaction tiers are unbuilt (YEN-31, YEN-70). No test scans receipts or API responses to verify absence of Yen IDs and real names. Named tests to be written: `apps/api/src/routes.test.ts` "never exposes 9-digit Yen ID in public endpoints, receipts, or event streams" and `apps/api/src/routes.test.ts` "redacts donor name according to selected visibility preference".

### CLAIM-30 Money actions require server-verified 6-digit PIN with lockout and cooling-off

- **Status:** planned
- **Wording:** "Configured approvers confirm with a 6-digit Yen PIN (recorded by Yen after PIN confirmation)"
- **Where:** README.md:49
- **Mechanism:** none. Server-side PIN verification planned under YEN-25, using keyed hash with secret outside DB, 5-attempt lockout for 30 minutes, 10-attempt lock requiring OTP support reset with 24-hour cooling-off notifying all members.
- **Test:** none
- **Reference:** `nist-800-63b`, `owasp-auth`, `owasp-password-storage`, `rfc-2104`
- **Missing:** Approvals are recorded by Yen after PIN confirmation and attested by the server rather than signed by the approver's device; a compromised server or operator could record an approval nobody gave (the event log stops later edits but not write-time fabricated approvals). Device-signed approvals via WebAuthn (YEN-71) are planned before Yen moves money. No PIN storage, keyed hashing, lockout tracking, or cooling-off reset notification code exists in the repository. Named tests to be written: `apps/api/src/pin.test.ts` "locks out after 5 consecutive failed attempts for 30 minutes", `apps/api/src/pin.test.ts` "requires owner reset with 24-hour cooling-off and member notifications after 10 failures", and `apps/api/src/pin.test.ts` "verifies single-use action-bound PIN and expires token within 60 seconds".
