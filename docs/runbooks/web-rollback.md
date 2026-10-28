# Web rollback runbook

Use this when a production deployment of `apps/web` is broken: the page returns
5xx, renders blank, points at the wrong API, or breaks a critical flow.

Roll back first. Diagnose afterwards.

## Instant rollback (dashboard)

1. Open the **Yen** project in the Vercel dashboard.
2. Find the last known good **Production** deployment. Check the commit and the
   green **Ready** state, not just the timestamp.
3. Use **Instant Rollback** on the Production deployment tile, or the `⋯` menu
   on that deployment row and choose **Instant Rollback**.
4. Select the target deployment and confirm with **Confirm Rollback**.

Vercel switches the production domain to the existing build. There is no
rebuild, so the switch normally completes within seconds.

## Instant rollback (CLI)

```sh
vercel login
vercel link            # once, from the repository root
vercel rollback <deployment-id-or-url>
vercel rollback status
```

`vercel rollback` restores the previous production deployment when no target is
given. Use `--timeout 0` to return as soon as the request is accepted. The CLI
needs access to the same Vercel team as the project.

## Verify the rollback

- `curl -sS -o /dev/null -w '%{http_code}\n' https://<production-domain>/`
  returns `200`.
- Open `/` and, when it exists, `/design-system` on a phone.
- In the browser network panel, confirm API calls go to the production origin,
  not staging or localhost.
- The Vercel project overview shows the restored deployment as the current
  production deployment.
- The broken deployment is still listed; it is not deleted.

## What a rollback does not do

- It does not rebuild. It restores the previous build and its baked-in
  `NEXT_PUBLIC_*` values.
- It does not change project environment variables. A bad value must be fixed
  in project settings and followed by a new deployment.
- It does not change `main`. Fix forward with a revert PR; never force-push the
  protected branch.

## After the rollback

1. Comment in the Linear issue and the pull request with the incident time, the
   bad deployment URL, the restored deployment URL, and the visible symptom.
2. Open a revert PR against `main` and let `CI Gate` run. Squash merge it once
   approved.
3. Fix the original change in a new PR. Do not promote the broken deployment
   back to production.
4. If the rollback was caused by a bad environment value, correct the value in
   Vercel, deploy `main` again, and verify before closing the incident.

## Rehearsal

Rehearse once before the first real release, on a production deployment that is
safe to replace:

1. Deploy a known-good build (A) to production and note its deployment URL.
2. Merge a harmless, visible change (B) and confirm production shows B.
3. Run an instant rollback to A and confirm production shows A again.
4. Promote B back to production (or deploy `main` again) and confirm B.
5. Record the result below. Do not count a preview-only test as a rehearsal;
   instant rollback acts on production.

| Date      | Operator | Rolled back from | Rolled back to | Result |
| --------- | -------- | ---------------- | -------------- | ------ |
| _pending_ |          |                  |                |        |
