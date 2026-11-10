# Runbooks

Operational procedures for pilot Yen deployments. Start with
[break-glass.md](break-glass.md): it defines the boundaries every responder
must respect before executing any other runbook.

| Document                                       | Use when                                                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [incident-response.md](incident-response.md)   | Incident protocol, severities, on-call rotation, escalation, club communication, API outage and crash loops, database failover and PITR, Merkle root verification failure and chain divergence |
| [anchor-recovery.md](anchor-recovery.md)       | Anchoring stalls on Polygon Amoy or Ethereum: empty publisher wallet, stuck nonce, gas price spikes, RPC outages                                                                               |
| [kms-rotation.md](kms-rotation.md)             | Leaked secrets, credential revocation, KMS signing key rotation                                                                                                                                |
| [account-compromise.md](account-compromise.md) | Compromised approver or owner account: session and passkey revocation, PIN lockout, recovery                                                                                                   |
| [break-glass.md](break-glass.md)               | Non-negotiable boundaries for incident response                                                                                                                                                |
| [backup-restore.md](backup-restore.md)         | Backup and restore drill, recovery objectives and their limits                                                                                                                                 |
| [web-rollback.md](web-rollback.md)             | Broken production deployment of the web tier                                                                                                                                                   |
| [demo-recording.md](demo-recording.md)         | Recording the demo video: repeatable clean slate with `pnpm demo:reset`, seeded accounts and credentials, screen-by-screen journeys and the simulated components list                          |

Continuous status probing uses `scripts/check-status.ts` from the repository
root:

```sh
pnpm exec tsx scripts/check-status.ts
```

It checks API liveness and readiness, database readiness, and the public fund
page, and prints a single JSON status payload. See the script header for
configuration.

Uptime probing with alerting uses `scripts/check-uptime.ts`:

```sh
pnpm exec tsx scripts/check-uptime.ts
```

It probes the web home page, API liveness and readiness, and one public fund
summary page, prints a single JSON status payload, and POSTs the failed check
summary to an alert webhook when any probe fails. Repeat alerts are held back
for five minutes through the optional state file, so a cron cadence shorter
than the window cannot storm the webhook. See the script header for
configuration.
