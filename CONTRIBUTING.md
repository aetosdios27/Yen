# Contributing to Yen

The full handbook lives in Linear (**06 · Engineering Handbook**). This file is the short version; if they differ, this file wins.

## The rule

**Nobody pushes to `main`. Not us, not admins, not bots.** Every change is a pull request, approved by someone other than its author, with CI green. GitHub rulesets enforce it and there are no bypass actors (`.github/rulesets/`).

## Flow

1. Pick a Linear issue and set it **In Progress**.
2. Branch with Linear's suggested name (e.g. `yourname/yen-18-db-schema-v1`).
3. Open a PR early; draft is fine.
4. PR title uses Conventional Commits and becomes the squashed commit message: `feat(ledger): post donation and event in one transaction`. Types: `feat fix perf refactor docs test build ci chore revert`.
5. Reference the issue (`YEN-<n>`) in the branch, title or description. CI fails otherwise.
6. Greptile reviews automatically. Fix or reply to every comment.
7. Another teammate approves. Aim to respond within one working day.
8. Resolve all conversations, keep the branch up to date, wait for **CI Gate**.
9. Squash and merge. The branch is deleted automatically.

Every pull request gets a Vercel preview from the bot comment. Open it on a
phone before approving; previews use the staging API, and production deploys
only after the squashed PR lands on `main`. See
[`docs/deployment/web.md`](docs/deployment/web.md) for setup and environment
rules, and the [rollback runbook](docs/runbooks/web-rollback.md) for incidents.

## What `main` enforces

| Rule                                 | Effect                                    |
| ------------------------------------ | ----------------------------------------- |
| Pull request required                | no direct push, force-push or deletion    |
| 1 approval, not from the last pusher | merging always needs two people           |
| Stale approvals dismissed            | new commits need a fresh approval         |
| Code-owner review                    | the approver must be listed in CODEOWNERS |
| Review threads resolved              | includes Greptile's                       |
| `CI Gate` green, branch up to date   | one required check aggregates everything  |
| Squash merge only, linear history    | one PR is one commit on `main`            |

## Local checks

```sh
pnpm install
pnpm verify        # biome ci + typecheck + test + build
pnpm format        # auto-fix formatting and safe lint issues
```

Requires Node 24 (`.nvmrc`) and pnpm (`packageManager` in `package.json`).

## Conventions

- Money is integer **paise** with the `Paise` branded type. Never floats.
- Parse external input with zod at the boundary; no `any`.
- No secrets in the repo; push protection and gitleaks are on.
- Events are append-only; never write code that updates or deletes them.

## Emergencies

Hotfixes use the same PR flow, just fast. If GitHub itself is broken, an admin may temporarily disable the ruleset in repository settings (audit-logged), then re-enable it immediately and write a short post-mortem.

## Repository settings as code

`.github/scripts/apply-repo-settings.sh` re-applies the repo settings and rulesets. Changes to `.github/rulesets/` go through a PR like everything else, then an admin runs the script.
