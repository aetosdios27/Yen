# Pilot readiness QA matrix

Scope for YEN-44: the Playwright suite in `apps/web/e2e`, the browser matrix in
`apps/web/playwright.config.ts`, and what each surface still needs before a
club pilot. Every claim here traces to a file or a command so it can be
re-verified by anyone with the repository.

## Modes

| Mode | Trigger            | Frontend           | API                                                  | What it proves                                          |
| ---- | ------------------ | ------------------ | ---------------------------------------------------- | ------------------------------------------------------- |
| mock | default            | real Next.js build | `e2e/support/stub-api.mjs` (seeded in-memory)        | page journeys, copy, and layout on every device profile |
| real | `E2E_BACKEND=real` | real Next.js build | built `createApp` on the Postgres stores (see below) | real auth, WebAuthn, ledger writes, and Merkle proofs   |

Real mode boots `apps/api/dist/app.js` (`createApp`) wired to the Postgres
stores that `apps/api/src/server-bootstrap.ts` uses, seeded by
`e2e/support/real-backend-global-setup.ts`. The setup replays the demo seed and
reconciles four seed-versus-runtime gaps (documented in its header comment and
in the findings table below); the journeys then run donate, expense with bill
upload, passkey approval, payout, bank reconciliation, and public Merkle
verification against the production code paths. Point it at a disposable
database with `E2E_DATABASE_URL`, for example `docker compose up -d postgres`
and `E2E_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres`.

One deliberate difference from the production entrypoint: the harness wires
`devPolicy` (its `can` delegates to the real `@yen/policy` engine) because the
production bootstrap does not wire any policy yet, so a server started from
`apps/api/src/server-bootstrap.ts` answers every fund write with 403. That gap
is tracked below as an open finding; it blocks staging deployments of the
write path regardless of this suite.

## Browser and device matrix

| Project     | Device profile                 | Engine   | Throttle                                                                                                                                             | Specs run                                                                               |
| ----------- | ------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `chromium`  | Desktop Chrome                 | Chromium | none                                                                                                                                                 | everything, including the real-backend journey                                          |
| `moto-g4`   | Moto G4 (360x640, DPR 3)       | Chromium | 4x CPU slowdown, regular 3G (1.6 Mbps down, 750 Kbps up, 150 ms RTT) via CDP `Emulation.setCPUThrottlingRate` and `Network.emulateNetworkConditions` | core journeys, a11y, Hindi, throttled journeys, real-backend journey                    |
| `iphone-13` | iPhone 13 (390x664, DPR 3)     | WebKit   | none                                                                                                                                                 | core journeys, a11y, Hindi (CDP WebAuthn specs skip: WebKit has no CDP WebAuthn domain) |
| `hi-in`     | Desktop Chrome, locale `hi-IN` | Chromium | none                                                                                                                                                 | everything; Hindi journeys flip the in-app locale switcher                              |

Host note for `iphone-13`: interaction specs probe pointer input once per
worker (`e2e/support/host.ts`) and skip on hosts whose WebKit build cannot
dispatch clicks or taps (observed on macOS 26 arm64 with Playwright 1.65,
headed and headless, on plain pages too, while navigation and JS evaluation
keep working). The Linux CI job runs the full iphone-13 project.

The app locale never follows the browser locale: the product ships an explicit
switcher (`apps/web/src/i18n/locale-provider.tsx`), so the `hi-in` project
drives the switcher instead of only setting `locale`.

Run everything with the repo's own invocation:

```sh
pnpm --filter @yen/web e2e                    # mock mode, all four projects
E2E_BACKEND=real E2E_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres pnpm --filter @yen/web e2e
```

CI runs the real-mode invocation in the `e2e` job of
`.github/workflows/ci.yml` (postgres service, Playwright browser install,
report artifact on failure), gated through the CI Gate job.

## Accessibility

`e2e/accessibility.spec.ts` runs axe (`@axe-core/playwright`, tags
`wcag2a` and `wcag21aa`) on the landing page, the public fund view, the
donation page, the fund dashboard, the verify page and the login page, in all
four projects. The assertion is zero critical and zero serious violations.
Component-level axe coverage continues to run through `pnpm turbo run
test:a11y --filter=@yen/web` (vitest-axe).

Current status: zero critical/serious violations on all six routes and all
four projects, in both mock and real mode, no disabled rules and no justified
exceptions.

## Virtual authenticator (passkeys)

`e2e/support/virtual-authenticator.ts` opens a CDP session per page
(`page.context().newCDPSession(page)`), sends `WebAuthn.enable` and
`WebAuthn.addVirtualAuthenticator` (CTAP2, internal transport, user verified),
then the journey drives `navigator.credentials.create` and
`navigator.credentials.get` on the real pages. Each test boots an empty
authenticator, so the approval test registers its own passkey before signing,
mirroring a fresh device. The API side is the production code path:
`@simplewebauthn/server` generates the options and verifies both the
registration (attestation) and the assertion, with the challenge claimed once
through the Postgres device signature store. The approval the passkey signs is
the `expense:approve` action hash, and the resulting `deviceProof` is consumed
by the approve route, so a passkey-signed approval is exercised end to end
without any hardware.

Constraints: Chromium only (Firefox and WebKit have no CDP WebAuthn domain).
The API `WEBAUTHN_RP_ID` must match the page host, so real mode serves the
browser from `http://localhost` and sets `WEBAUTHN_RP_ID=localhost`,
`WEBAUTHN_ORIGIN=http://localhost:<port>`.

## Flake rate

Measurement: run the full matrix (`pnpm --filter @yen/web e2e`) repeatedly on
one machine, then compute

```
flake rate = flaky results / finished results
```

where a flaky result is a test that failed at first attempt and passed on
retry (`retries` is 1 in CI; Playwright marks such results as `flaky` in the
HTML/JUnit report and as `✘→✓` in list output). Local runs use retries 0, so
any failure counts against the flake budget and is triaged before the next
run. The target is below 2%.

Observed so far (macOS 26 arm64, local runner):

| Date       | Mode | Runs | Results | Flaky | Flake rate | Notes                                         |
| ---------- | ---- | ---- | ------- | ----- | ---------- | --------------------------------------------- |
| 2026-11-11 | mock | 5    | 310     | 0     | 0.0%       | all four projects, stub state reset per test  |
| 2026-11-11 | real | 3    | 195     | 0     | 0.0%       | all four projects against a local Postgres 16 |

Honest caveats on these numbers: they are local-only (no CI retries involved),
iphone-13 interaction specs skip on this host (see the host note above), and
the totals count finished test results. The table should gain a row per CI run
once the GitHub Actions e2e job has history.

## Known gaps and honest caveats

| Gap                                                               | Impact                                                                                                                                                                                                                                                                                                                            | Where                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Production bootstrap wires no RBAC policy                         | Real servers built from `server-bootstrap.ts` deny every fund write (403), which blocks staging and the donate page (`donation-details` 404s). The e2e real mode wires `devPolicy` itself.                                                                                                                                        | `apps/api/src/server-bootstrap.ts`                                             |
| `pnpm db:reset` never installs the 0037 ledger totals machinery   | The 0037 install hook skips itself while the konto tables do not exist, so `yen_konto_available` never lands and every transfer on a reset database fails with 500. The e2e setup applies `packages/ledger/src/schema.sql` first and then invokes `yen_init_konto_totals()`, the order `packages/db/src/migrate.test.ts` blesses. | `packages/db/src/dev-seed.ts`, `packages/db/migrations/0037_ledger_totals.sql` |
| Dev seed drops the full konto tables and skips verified bank rows | The seed hand-rolls minimal konto tables (no column defaults) and verifies donations without the matched bank_transactions rows the public summary's raised total derives from, so reset databases read a zero spendable balance. The e2e setup drops the seed tables and re-inserts the seed economics plus matched credits.     | `packages/db/src/dev-seed.ts`                                                  |
| Seeded mock sessions carry no trusted device row                  | The real auth middleware resolves a principal only for sessions with a trusted device (what an OTP login establishes), so the seeded persona tokens authenticate nowhere outside the e2e setup, which marks them trusted.                                                                                                         | `packages/db/src/dev-seed.ts`, `apps/api/src/middleware.ts`                    |
| Web expense client skipped the payee fields it collects           | Every expense created through the UI had `payee: null` and the real API rejected the submit (the stub masked it). Fixed in this branch; worth a regression test at the component level.                                                                                                                                           | `apps/web/src/lib/expense-service.ts`                                          |
| Fund policy objection window blocks the payout journey            | With the seed fund's 48-hour window the expense stays `submitted` after quorum and `pay` returns 409 until it elapses. The e2e setup sets `objectionWindowHours: 0` on the seed fund; pilot clubs need this documented.                                                                                                           | `packages/ledger/src/expense/state-machine.ts`                                 |
| No anchor worker in e2e                                           | Records verify as `pending` (sealed in the event log, anchor awaiting). Anchored proofs are covered by queue integration tests, not browser e2e.                                                                                                                                                                                  | `packages/queue`                                                               |
| OTP delivery is a stub                                            | The seeded mock sessions stand in for OTP logins; the login page is exercised in form-validation depth only.                                                                                                                                                                                                                      | `apps/api/src/auth/provider.ts`                                                |
| Virus scan is the local demo adapter in e2e                       | Uploads are accepted without a real ClamAV scan; production requires `CLAMAV_HOST`.                                                                                                                                                                                                                                               | `apps/api/src/virus-scanner.ts`                                                |
| Payout adapter is the reference mock (`ENABLE_MOCK_PAYOUTS=true`) | The pay step proves the ledger transition, not a real partner payout.                                                                                                                                                                                                                                                             | `packages/ledger/src/payout.ts`                                                |
