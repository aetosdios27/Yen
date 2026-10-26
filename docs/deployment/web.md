# Deploying the web app

`apps/web` is hosted on Vercel through its GitHub integration. Vercel builds the
app, posts a preview URL on every pull request, and deploys production only from
`main`. API hosting is tracked separately.

The build settings live in [`apps/web/vercel.json`](../../apps/web/vercel.json),
so they are reviewed like code. Do not override them in the Vercel dashboard.

## Project setup (once)

An owner with access to the Vercel team imports the upstream repository and
configures the project as follows.

1. Import `aetosdios27/Yen` (the upstream repository, not a fork).
2. Set **Root Directory** to `apps/web`.
3. Use the **Next.js** framework preset and **Node.js 24.x**, matching
   [`.nvmrc`](../../.nvmrc) and the `engines` field in `apps/web/package.json`.
4. Leave **Include source files outside of the Root Directory in the Build
   Step** enabled. `@yen/shared` lives in `packages/shared` and must be built
   before the web app.
5. Set **Production Branch** to `main`. Every other branch is a preview.
6. Keep Git comments enabled so the Vercel bot comments the preview URL on the
   pull request. Do not enable silent mode.
7. Keep monorepo change detection enabled. A change to `apps/web`,
   `packages/shared`, the lockfile, or a shared config rebuilds the preview; a
   change that cannot affect the web app is skipped.
8. Under **Deployment Protection**, use Vercel Authentication (standard
   protection). Reviewers sign in with their Vercel team account. If someone
   outside the team must open a preview, use a Vercel Shareable Link for that
   deployment rather than making previews public.

Vercel reads the install path from the Root Directory. The committed
`installCommand` installs `@yen/web`, `@yen/shared`, and the root build tooling
(the pinned Turbo and TypeScript), while leaving the API, contracts and
unrelated packages out:

```sh
pnpm install --filter @yen/web... --filter yen --frozen-lockfile
```

The build runs Turborepo from the repository root so `@yen/shared` is built
first, then `@yen/web`:

```sh
cd ../.. && pnpm turbo run build --filter=@yen/web
```

Turborepo's `dependsOn: ["^build"]` resolves `@yen/shared` without building the
API, contracts, or unrelated packages. Functions use `bom1` (Mumbai) as their
default region; static assets are served from Vercel's CDN. Edge routes, if any
are added later, choose their own region and are not pinned by this setting.

## Environment variables

Set every value in **Project → Settings → Environment Variables**. Never commit
deployment values, and never put them in `vercel.json`: that file is shared by
preview and production.

| Variable              | Production                | Preview                   | Development             |
| --------------------- | ------------------------- | ------------------------- | ----------------------- |
| `NEXT_PUBLIC_API_URL` | production API origin     | staging API origin        | `http://localhost:3001` |

The origins are the deployed API URLs for each environment; keep them in the
team password manager or the Linear infrastructure note, not in this file.

Scope rules:

- Tick **only Production** for the production API origin. Tick **only Preview**
  for the staging origin. A value scoped to Production is never injected into a
  preview build.
- `NEXT_PUBLIC_*` values are public and inlined at build time. They must never
  hold a secret. Changing one requires a new deployment; an instant rollback
  restores the old build and its old value.
- Any future server-only secret uses Production scope only, has no
  `NEXT_PUBLIC_` prefix, and stays out of preview builds. There is no use for a
  production secret in this app today.
- `.env` files are local only and gitignored. `vercel env pull` is convenient
  for local development but must be pulled from the Development environment.

## Preview deployments

A pull request that changes `apps/web` (or `packages/shared`) gets a Vercel
preview deployment. The bot comments the URL on the PR. The URL is per commit,
so check it after the last push, not after the first.

Before approving, open the preview on a phone-sized viewport and confirm:

- the page loads over HTTPS with no console errors;
- API requests go to the staging origin, never production or localhost;
- `/design-system` renders at 375 px once the design-system work is merged;
- language switching works without a reload.

If a preview is missing, check the Root Directory, the monorepo change
detection, and Deployment Protection before re-running the deployment.

## Production deployments

Production deploys only from `main`. The expected path is:

1. `CI Gate` and the required CodeQL check pass on the pull request.
2. A reviewer other than the author approves.
3. The PR is squashed and merged into `main`.
4. Vercel builds `main` with Production-scoped variables and promotes it to the
   production domain.

Nobody deploys to production from a laptop during normal work, and direct
pushes to `main` are blocked by the branch ruleset.

## One merge gate

`CI Gate` remains the application merge gate. The `main` ruleset also keeps the
required CodeQL check, as it did before this change. Vercel's deployment check
is **informational**: it is deliberately not added to
[`.github/rulesets/main.json`](../../.github/rulesets/main.json).

That ordering is what makes production safe: if `CI Gate` fails, the merge is
blocked, so the production deployment never starts. A red Vercel preview is a
review signal, not a second required status check.

## First rollout checklist

The repository configuration is inert until the project is imported. Complete
these steps in order:

- [ ] Import the project with the settings above and set both
      `NEXT_PUBLIC_API_URL` scopes.
- [ ] Redeploy `main` and confirm the production URL loads with the production
      API origin.
- [ ] Open a small PR touching `apps/web` and confirm the Vercel bot comments a
      working preview URL; open it on a phone.
- [ ] Confirm the preview uses the staging API origin and cannot see the
      production value.
- [ ] Merge a harmless change to `main` and confirm production updates.
- [ ] Rehearse the [rollback runbook](../runbooks/web-rollback.md) once and
      record the deployment IDs and date there.
