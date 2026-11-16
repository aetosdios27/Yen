# Yen code quality rules

These rules are binding for every change in this repository. They add to
[CONTRIBUTING.md](../../CONTRIBUTING.md); where they are stricter, they win.
Every rule is a requirement. If a rule is wrong, change this file in its own
PR first.

## 1. Pull requests

- One purpose per PR. A PR that needs "and" in its title is two PRs.
- At most 600 changed lines outside tests, generated files, lockfiles and
  message catalogs. Larger work is a stack of PRs that each leave `main` working.
- The description states the problem in one or two sentences, then the change,
  then the proof. Proof is something observed: a command and its result, a
  screenshot, a reproduction that failed before and passes after.
- UI changes include before and after screenshots at 390 and 1440 px.
- No drive-by refactors, renames or formatting in a feature PR.
- CI green, zero warnings added, all review threads resolved before merge.
- A PR never weakens a check to pass: no skipped tests, no raised budgets, no
  new lint ignores, no new entries in a baseline file.

## 2. TypeScript

- `strict` stays on. No `any`, no non-null `!`, no `as` casts except `as const`
  and narrowing a value that was just validated. No `@ts-ignore` or
  `@ts-expect-error` outside tests.
- External input (HTTP, env, storage, URL params, third-party responses) is
  parsed with zod at the boundary. Inside the boundary, types are trusted and
  not re-checked.
- Make illegal states unrepresentable: discriminated unions over booleans and
  optional fields, branded types for ids and money (`Paise`, `FundId`).
- Money is integer paise in a `Paise` branded type or a decimal string on the
  wire. Never `number` arithmetic on rupees, never floats.
- `switch` over a union is exhaustive with a `never` check.
- Functions take at most three positional parameters; more become one object.
- No default exports, except where Next.js requires them (pages, layouts,
  route files, config).
- No enums, no namespaces, no classes for plain data.
- Errors are typed results or thrown `ApiError`-style domain errors. Never
  throw strings. Never catch and ignore: a `catch` handles, rethrows or
  reports.

## 3. Structure

- A file has one job. Limits: 300 lines for any source file, 200 for a React
  component file, 60 for a function, 4 levels of nesting. Tests are exempt
  from the file limit.
- One exported React component per file. File name is the kebab-case component name.
- No barrel files (`index.ts` that only re-exports) inside `apps/*`.
- No abstraction with one caller. No option, parameter or prop nobody passes.
- Delete dead code in the PR that kills it. No commented-out code, no
  `TODO` without a `YEN-<n>` issue id.
- Dependencies point one way: `apps` may import `packages`, `packages` never
  import `apps`, and `packages/shared` imports nothing internal.
- A new runtime dependency needs one line in the PR description: what it is
  for, its size, and why existing code cannot do it.

## 4. React and Next.js

- Server Components by default. `"use client"` appears only in a leaf that
  needs state, effects or browser APIs, and the file says why in one line.
- Data is fetched on the server where possible. No fetch-in-`useEffect` for
  data that is known at request time.
- No `useEffect` to derive state from props or state. Compute during render.
- Every async view has a loading state, an empty state and an error state.
  A failed request is never rendered as empty data.
- Forms: one source of truth, validation with the same zod schema the API
  uses, submit is idempotent (an idempotency key lives for the life of the
  form, not per click), errors appear next to the field.
- Every interactive element is a real `button`, `a` or form control. No
  click handlers on `div` or `span`.
- Every visible string comes from `src/i18n/messages`, in English and Hindi.
  No string literals in JSX except punctuation.
- Dates, times and money are formatted only through `src/lib/format`.
- Styling follows [docs/design/DESIGN.md](../design/DESIGN.md): tokens only,
  no inline `style`, no arbitrary values, no `!important`.
- The API is called only through the generated client in `@yen/api-client`.
  No hand-written `fetch` to the API.

## 5. API and data

- Every route has a zod contract, an OpenAPI entry and a policy check. The
  generated client is regenerated in the same PR.
- Every write is idempotent and runs in one transaction with its event.
- Events are append-only. Nothing updates or deletes them.
- Authorization is checked on the server for every request. Hiding a control
  in the interface is never the access control.
- Queries added or changed in a hot path include their `EXPLAIN` budget test.
- Migrations are forward-only, numbered, and never edited after merge.
- A development convenience is impossible in production by construction: it
  is gated on explicit `NODE_ENV=development` (the raw variable, never the
  default), resolved in one place, with a test for production, test and unset.
- Secrets never appear in code, logs, error messages, URLs or test output.
- Logs are structured, carry a request id, and contain no personal data.

## 6. Tests

- Tests assert behaviour a user or caller can observe. They fail when the
  behaviour breaks and keep passing when internals change.
- No snapshot tests. No tests of implementation details, private functions or
  class names. No `sleep`: wait on a condition.
- Every bug fix lands with a test that fails without the fix.
- Every component with states has one test per state. Every form has a test
  for the error path.
- Mocks are allowed only at the process boundary (network, clock, storage).
  Tests against Postgres use a real Postgres.
- A flaky test is fixed or deleted the day it flakes. It is never retried
  into passing.
- `pnpm verify` passes locally before a PR is opened.

## 7. Comments and naming

- Code says what, names say why. A comment is allowed only for a reason the
  code cannot show: a constraint, a trade-off, a link to the rule it follows.
- No comments that narrate the change, restate the code, or mark sections.
- Names are full words. No abbreviations except `id`, `url`, `api`, `ui`,
  `otp`, `pin`, `upi`, `vpa`. Booleans read as facts (`isSettled`, `hasQuorum`).
- Functions are verbs, values are nouns, components are nouns.
- The same concept has the same name in the database, API, client and
  interface copy.

## 8. Enforcement

- Biome, TypeScript, tests and build run in `pnpm verify` and in CI Gate.
- `pnpm check:design` enforces the design rules.
- `pnpm check:code` (added by YEN-99) enforces file and function size limits, default exports,
  barrel files, hand-written API `fetch`, JSX string literals, `TODO`
  without an issue, and `useEffect` data fetching. Existing violations are
  listed in a baseline file that only shrinks.
- A rule that a tool can check is checked by a tool. Review covers the rest
  and rejects on any rule in this file without further argument.
