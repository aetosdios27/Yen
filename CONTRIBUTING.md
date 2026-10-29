# Contributing to Yen

The full handbook lives in Linear (**06 · Engineering Handbook**). This file is the short version; if they differ, this file wins.

## The rule

**Nobody pushes to `main`. Not us, not admins, not bots.** Every change is a pull request with CI green. GitHub rulesets enforce it and there are no bypass actors (`.github/rulesets/`).

## Flow

1. Pick a Linear issue and set it **In Progress**.
2. Branch with Linear's suggested name (e.g. `yourname/yen-18-db-schema-v1`).
3. Open a PR early; draft is fine.
4. PR title uses Conventional Commits and becomes the squashed commit message: `feat(ledger): post donation and event in one transaction`. Types: `feat fix perf refactor docs test build ci chore revert`.
5. Reference the issue (`YEN-<n>`) in the branch, title or description. CI fails otherwise.
6. Greptile reviews automatically when it is available. Fix or reply to its comments; it is advisory, not a merge gate.
7. A teammate review is welcome but not required; the merge gate is CI.
8. Resolve all conversations, keep the branch up to date, and wait for **CI Gate** and CodeQL.
9. Squash and merge. The branch is deleted automatically.

Every pull request gets a Vercel preview from the bot comment. Open it on a
phone before approving; previews use the staging API, and production deploys
only after the squashed PR lands on `main`. See
[`docs/deployment/web.md`](docs/deployment/web.md) for setup and environment
rules, and the [rollback runbook](docs/runbooks/web-rollback.md) for incidents.

## What `main` enforces

| Rule                              | Effect                                 |
| --------------------------------- | -------------------------------------- |
| Pull request required             | no direct push, force-push or deletion |
| No human approval required        | the merge gate is CI and CodeQL        |
| Stale approvals dismissed         | new commits void earlier approvals     |
| Review threads resolved           | includes any bot's                     |
| `CI Gate` and CodeQL green        | required checks aggregate everything   |
| Squash merge only, linear history | one PR is one commit on `main`         |

## How to cite

ADRs and design-heavy PRs must cite relevant entries in [References](docs/REFERENCES.md), explain what they take and where the design differs, or explicitly state “no prior art found” when true. Add new primary sources only after opening and reading them and verifying their metadata, URL, and the claim attributed to them.

## Local checks

```sh
pnpm install
pnpm verify        # biome ci + typecheck + test + build
pnpm format        # auto-fix formatting and safe lint issues
```

Requires Node 24.21.0 (`.nvmrc`) and pnpm 12.6.0 (`packageManager` in
`package.json`).

## Conventions

- Money is integer **paise** with the `Paise` branded type. Never floats.
- Parse external input with zod at the boundary; no `any`.
- No secrets in the repo; push protection and gitleaks are on.
- Events are append-only; never write code that updates or deletes them.

## Emergencies

Hotfixes use the same PR flow, just fast. If GitHub itself is broken, an admin may temporarily disable the ruleset in repository settings (audit-logged), then re-enable it immediately and write a short post-mortem.

## Repository settings as code

`.github/scripts/apply-repo-settings.sh` re-applies the repo settings and rulesets. Changes to `.github/rulesets/` go through a PR like everything else, then an admin runs the script.
