# Leaked secret response, credential revocation and KMS key rotation

Use this runbook when a secret or credential used by a Yen deployment may have
been exposed: committed to a repository, printed into logs, present in a
screenshot, held on a lost device, or otherwise observable by someone who should
not have it. Severity is SEV-1 until revocation and rotation complete, regardless
of whether the material shows signs of use.

## Inventory of deployment secrets

Before an incident, know what exists. A pilot deployment holds, at minimum:

| Credential                                       | Where it lives                                                                       | What a leak enables                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `DATABASE_URL` (with password)                   | deployment environment, `.env` (never committed)                                     | Full read and write of fund data, events, sessions                       |
| `ANCHOR_KMS_KEY_ID` plus AWS credentials         | IAM role of the worker                                                               | Signing anchors; scoped by KMS key policy, key material never leaves KMS |
| `ANCHOR_PRIVATE_KEY`                             | local development only, requires `ANCHOR_ALLOW_LOCAL_SIGNER=true` outside production | Signing anchors as the local publisher; must never exist in production   |
| `PARTNER_WEBHOOK_SECRET`                         | deployment environment                                                               | Forging partner webhook signatures                                       |
| Delivery provider credentials (`WHATSAPP_API_*`) | deployment environment                                                               | Sending messages as the club                                             |
| Publisher wallet native token                    | Polygon Amoy (testnet)                                                               | Paying gas for anchor publishing                                         |
| `ETHERSCAN_API_KEY`                              | CI                                                                                   | Verification API quota abuse (low impact)                                |
| Repository and CI secrets                        | GitHub settings                                                                      | Release tampering if write access leaks                                  |

The `.env.example` file lists the full set with usage notes. Committing any
`.env` file is a SEV-1 leak by definition.

## Universal response sequence

Work top to bottom; do not skip the evidence step even when the pressure to
rotate is high.

1. Classify the leak: which credential, which exposure surface (git history,
   logs, third-party paste site, lost device), when exposed, and who had access.
   Record it in a SEV-1 incident thread per
   [incident-response.md](incident-response.md).
2. Revoke first, rotate second, investigate third. A credential that is revoked
   cannot be used while you investigate; a credential you investigate first can
   be used by an attacker in that window.
3. Revoke (per credential below).
4. Rotate to a fresh value and redeploy.
5. Check for use of the old credential during the exposure window. For the
   database, review `pg_stat_activity` history, provider audit logs, and
   authentication logs. For the chain, list every anchor published in the window
   and confirm each against the `anchors` table
   ([anchor-recovery.md](anchor-recovery.md)).
6. If the leak touched fund data or event logs, apply the divergence scenario in
   [incident-response.md](incident-response.md) before declaring recovery.
7. Close with a post-mortem covering how the leak became possible.

## Revocation and rotation per credential

### Database credentials

Revoke: no shared "revoke" exists for a password, so rotate the password and
terminate existing sessions in one maintenance step.

```sh
psql "$ADMIN_DATABASE_URL" -c "ALTER ROLE <app-role> PASSWORD '<new-password>';"
psql "$ADMIN_DATABASE_URL" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '<app-role>' AND pid <> pg_backend_pid();"
```

Then update `DATABASE_URL` in the deployment environment and restart the API and
worker so new connections use the new password. If the leaked URL allowed
superuser access, review role definitions and database objects for unexpected
changes before resuming writes.

### Anchor signing key (KMS)

In production the anchor signer is AWS KMS
(`packages/queue/src/anchoring.ts`, `KmsRootSigner`): the worker holds
`ANCHOR_KMS_KEY_ID` plus AWS credentials, and signs with `SignCommand`; key
material never leaves the service, so a leaked `ANCHOR_KMS_KEY_ID` alone is not
usable. The dangerous combinations are leaked AWS credentials that can call
`kms:Sign` on the key, or a leaked key policy that grants signing too broadly.

1. Revoke signing ability immediately: detach the key policy statement granting
   `kms:Sign` to the leaked principal, or disable the IAM credentials of the
   leaked role. Verify with `aws kms get-key-policy`.
2. Create a replacement KMS asymmetric key (the signer requires
   `ECC_SECG_P256K1` with `ECDSA_SHA_256` and fails closed otherwise, so the
   new key must use the same key spec), grant `kms:Sign` and `kms:GetPublicKey`
   only to the
   worker role, and set the new `ANCHOR_KMS_KEY_ID`.
3. The publisher address changes with the new key. `RootRegistry` allows a
   single publisher and rotates authority with a two-step transfer; from the
   current publisher account:

   ```sh
   cast send "$ROOT_REGISTRY_ADDRESS" "proposePublisher(address)" <new-publisher-address> --rpc-url "$ANCHOR_RPC_URL" --private-key <current-publisher-key>
   cast send "$ROOT_REGISTRY_ADDRESS" "acceptPublisher()" --rpc-url "$ANCHOR_RPC_URL" --private-key <new-publisher-key>
   ```

   Fund the new publisher address with native token before accepting so
   anchoring does not stall (see [anchor-recovery.md](anchor-recovery.md)).
4. Restart the worker, confirm one anchor reaches `confirmed`, and confirm the
   KMS audit log shows no `Sign` calls from the leaked principal during the
   exposure window.
5. Schedule deletion of the old KMS key only after verifying every anchor
   published with it; keep it disabled, not deleted, until the incident closes.

### Local development signer key

`ANCHOR_PRIVATE_KEY` is accepted only when `NODE_ENV !== "production"` and
`ANCHOR_ALLOW_LOCAL_SIGNER=true`. A leaked local key has no production
authority, but rotate it anyway: generate a fresh 32-byte hex key for
development, and remove the leaked value from wherever it appeared.

### Partner webhook secret

Rotate `PARTNER_WEBHOOK_SECRET` (32 characters or more) in the deployment
environment and restart the API. Until rotated, the API rejects every webhook
when the variable is unset; if you need a hard stop, unset it first and set the
new value after partners are re-keyed.

### Delivery provider credentials

Rotate the leaked `WHATSAPP_API_*` credential in the provider console, update
the deployment environment, and send one test notification. Review the provider
message log for messages sent in the exposure window that the club did not send.

### Repository and CI access

For a leaked GitHub token or compromised maintainer account, revoke the token
in GitHub settings, audit recent commits, workflow runs, and releases, and
follow [../release-supply-chain-audit.md](../release-supply-chain-audit.md) to
validate that no release artifact was tampered with. Rotate the `GITHUB_TOKEN`
secrets used by the release workflow and re-run the latest release verification
before publishing again.

## Secret hygiene that this repository already enforces

These points exist so responders can trust some things during an incident:

- `.env` files are git-ignored; the committed `.env.example` contains only
  placeholders.
- The worker refuses to start anchoring with a local signer in production
  (`anchoringSignerMode` in `packages/queue/src/env.ts`).
- Fee ceilings for anchor replacement are code constants, not secrets, so a
  leaked environment file does not change verification behavior.
- Invalid worker environments fail startup with messages that name variables
  but never echo values.

If an incident shows one of these guarantees is wrong, that is itself a SEV-1
finding for the post-mortem.
