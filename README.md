# Yen

Community money you can check. Donors verify every rupee; treasurers cannot quietly spend it.

Funds stay in the club's own bank account. Yen records every donation and expense as a tamper-evident event, requires approvals before spending, matches bank activity against what was approved, and publishes periodic fingerprints on a public blockchain so anyone can check the record has not been rewritten.

**Status:** pre-MVP, foundation phase. Work is tracked in Linear (project _Yen MVP_).

## Layout

```
apps/        web (Next.js) and api (Hono), coming with YEN-11
packages/    shared (types, money, Merkle verify); ledger, eventlog to come
contracts/   Foundry project (RootRegistry), coming with YEN-16
infra/       Terraform, coming with YEN-17
```

## Getting started

```sh
nvm use            # Node 24
pnpm install
pnpm verify
```

How we work: see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

Not yet decided; all rights reserved until we choose one.
