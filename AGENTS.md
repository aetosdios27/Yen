# Instructions for coding agents

Read these before changing anything. They are binding, not advice.

1. [CONTRIBUTING.md](CONTRIBUTING.md): the flow, the merge gate, money and event rules.
2. [docs/engineering/CODE-QUALITY.md](docs/engineering/CODE-QUALITY.md): code rules for every package.
3. [docs/design/DESIGN.md](docs/design/DESIGN.md): design rules for everything under `apps/web`.

Non-negotiable:

- Never push to `main`. Open a pull request and wait for CI Gate.
- Run `pnpm verify` before opening a PR. For `apps/web`, also run
  `pnpm check:design` (added by YEN-99) and attach screenshots at 390 and 1440 px.
- Never weaken a check, skip a test, add a lint ignore or grow a baseline file.
- Never make a development convenience reachable in production.
- Prove the change by running it. A passing mocked test is not proof that a
  screen works.
- If a rule blocks the task, stop and say so. Do not work around it.
