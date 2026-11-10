# API continuous deployment

The API container is deployed by [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)
with the mechanics in [`scripts/deploy-api.sh`](../../scripts/deploy-api.sh).
This document explains the flow, the guarantees the pipeline makes, and how
to run, validate, and roll back a deployment.

## Pipeline shape

A push to `main` that touches `apps/api`, `packages/db`, the root
`Dockerfile`, or the workflow itself starts the pipeline. Everything else
(README edits, web app changes, docs) does not. A `workflow_dispatch` input
allows a manual dry run. A single concurrency group serializes runs against
the same ref and never cancels an in-flight rollout: a superseded run
finishes so the service is never left between two task definitions.

The job graph, in order:

```text
image
  -> migrate-staging
    -> deploy-staging
      -> smoke-staging
        -> migrate-production (manual approval)
          -> deploy-production
            -> smoke-production
```

Each arrow is a `needs` edge: a job only starts when every job before it
succeeded. That single rule carries most of the pipeline's guarantees.

The `image` job builds the API container once per run from the root
`Dockerfile`, pushes it to ECR tagged `sha-<commit>`, and records the
immutable digest `sha256:...`. Every later job promotes that exact digest;
nothing is rebuilt between staging and production, so what was smoke tested
is byte for byte what production runs. The digest also pins the image in
every registered task definition, so a mutable tag can never swap the bytes
under a running service.

Until the root `Dockerfile` lands with the API image work, the guard step in
the `image` job reports `ready=false` and every later job skips itself, so
the pipeline stays green and dormant instead of failing every merge.

## Environments and approval

Two GitHub Environments are used, both declared per job:

- `staging`: no required reviewers. A merge to `main` deploys staging
  automatically, migrations included.
- `production`: configured with required reviewers in the repository
  settings. Both `migrate-production` and `deploy-production` declare
  `environment: production`, so the run pauses at the production migration
  until a maintainer approves it. Approval happens before any production
  change, database or container, and a rejected approval stops the run.

Create both environments under Settings -> Environments. Configure required
reviewers only on `production`. The environment-scoped variables and secrets
are listed in the setup section below.

## Cloud access through OpenID Connect

No long-lived cloud credentials are stored in GitHub Secrets. Every job that
touches infrastructure declares `id-token: write` and the deploy script
exchanges the runner's short-lived OIDC token for temporary cloud
credentials through `aws sts assume-role-with-web-identity`, with a 900
second session. The only secret the workflow references is
`MIGRATION_SECRET_ID`, which is a Secrets Manager identifier, not a
credential: the database URL it holds is fetched at deploy time inside the
cloud session and injected into the migration task only.

One-time cloud setup:

1. Create an OIDC identity provider in IAM for
   `token.actions.githubusercontent.com` if one does not exist yet.
2. Create two IAM roles, one for staging and one for production, trusting
   that provider. Scope the trust policy to this repository and branch, for
   example `repo:aetosdios27/Yen:ref:refs/heads/main`, and to the GitHub
   environment claim for production. Grant each role only the permissions it
   needs: ECR push for the image role; ECS, Secrets Manager read, and IAM
   pass-role for the deploy roles.
3. Create the ECR repository named by `ECR_REPOSITORY` with immutable tags.
4. Create the ECS cluster, the API service, and a task definition family for
   migration one-off tasks (the same container image with a migration
   entrypoint).
5. Store the migration `DATABASE_URL` in Secrets Manager.

Then set these repository or environment variables in GitHub:

| Variable                        | Meaning                                         |
| ------------------------------- | ----------------------------------------------- |
| `OIDC_ROLE_ARN`                 | IAM role the job assumes (per environment)      |
| `AWS_REGION`                    | Cloud region                                    |
| `ECR_REPOSITORY`                | ECR repository for the API image                |
| `ECS_CLUSTER`                   | ECS cluster for the environment                 |
| `ECS_SERVICE`                   | ECS service backing the API                     |
| `ECS_CONTAINER_NAME`            | Container name inside the task definition       |
| `ECS_MIGRATION_TASK_DEFINITION` | Task definition family for migration tasks      |
| `ECS_SUBNETS`                   | Comma separated subnet ids for one-off tasks    |
| `ECS_SECURITY_GROUPS`           | Comma separated security group ids              |
| `API_BASE_URL`                  | Public HTTPS base URL, used by the smoke probes |

And the environment secret:

| Secret                | Meaning                                                 |
| --------------------- | ------------------------------------------------------- |
| `MIGRATION_SECRET_ID` | Secrets Manager id holding the migration `DATABASE_URL` |

## Migrations run before traffic shifts

Database migrations never run inside the containers that serve traffic.
Before each environment rollout, the pipeline starts a one-off FARGATE task
(from the migration task definition family, re-registered with the new image
digest pinned) that runs the migrator from `packages/db`, `node
packages/db/dist/cli.js`, against the production database with the
`DATABASE_URL` injected at task start. The job waits for the task to stop
and requires exit code 0.

Because `deploy-<env>` declares `needs: migrate-<env>`, a failed migration
halts the rollout before any container is replaced. The ECS service keeps
serving the previous task definition and nothing about the traffic path
changes. This holds for staging and production alike.

Why the migration task definition is re-registered instead of using
`run-task` overrides: ECS overrides can replace a container command but
cannot pin an image, so the only way to guarantee the migration runs against
the exact digest that will serve traffic is to register the family with that
digest first.

## Proving that a bad migration halts the rollout

The full failure path is covered by an offline negative test that needs no
cloud account:

```sh
bash scripts/deploy-api.sh selftest
```

The selftest puts a fake `aws` CLI and a fake `curl` on `PATH` and drives
the real `migrate`, `deploy`, `rollback` and `smoke` code paths. The first
check forces the migration container to exit nonzero and asserts the
`migrate` command fails with
`rollout halted before any container was replaced`. The remaining checks
prove the healthy paths: a zero exit migration unblocks the rollout, a
digest pin is enforced, an unstable service fails the deploy, rollback
routes to the previous revision, and the smoke probes accept and reject the
right servers. Run it locally or in CI; it is the executable specification
of the migration gate.

Workflow-level validation is documented in "Validating without deploying"
below.

## Smoke probes

After each rollout the `smoke-<env>` job probes the live environment over
HTTPS:

1. `/health` returns a 2xx status (HTTPS reachability).
2. `/ready` reports every dependency as ok (`status == "ok"`).
3. `/version` reports a `gitSha` equal to the commit that was deployed.

Each probe retries for up to two minutes (`SMOKE_TIMEOUT_SECS` overrides
this) so a slow rollout does not fail spuriously, then fails hard. A failed
staging smoke test stops the run before production migration and production
deploy are ever considered. The probes run last in each environment, so a
green run means a reachable, ready service serving the expected commit.

## One command rollback

Rollback routes the ECS service back to an earlier, already registered task
definition revision. Nothing is rebuilt and no migration runs:

```sh
# staging, to the previous revision
bash scripts/deploy-api.sh rollback staging

# production, to an explicit revision
bash scripts/deploy-api.sh rollback production 41
```

With no explicit revision the command targets the revision before the one
currently serving. It refuses to target a revision that is not older than
the current one, and it waits for service stability with the same circuit
breaker configuration as a forward deploy.

Rollback is for application failures, not for undoing a schema migration.
If a migration corrupts data, restore from a backup following
[`docs/runbooks/backup-restore.md`](../runbooks/backup-restore.md).

Verifiability: the selftest includes the rollback path offline (it asserts
the service is pointed at the previous revision and that a non-older
revision is refused), and every subcommand accepts a dry run:

```sh
DRY_RUN=1 bash scripts/deploy-api.sh rollback staging
```

A dry run prints the exact commands it would run, including the
`update-service` call with the target revision, without touching the cloud.

## Validating without deploying

Three levels, all runnable without a cloud account:

1. Offline selftest, the strongest check, exercises the real code paths
   against fakes, including the migration failure negative test:

   ```sh
   bash scripts/deploy-api.sh selftest
   ```

2. Dry run of any subcommand prints the infrastructure plan instead of
   executing it:

   ```sh
   DRY_RUN=1 bash scripts/deploy-api.sh deploy staging sha256:...
   ```

   The same dry run is available from GitHub by dispatching the workflow
   with the `dry_run` input set to true. A dry run of the workflow skips the
   smoke probes, since nothing was deployed.

3. Workflow syntax check with actionlint, if installed:

   ```sh
   actionlint .github/workflows/deploy.yml
   ```

## Operating notes

- The migration job and the deploy job of the same environment both run
  under the same GitHub Environment, so both inherit the same variables and
  the same reviewer requirement on production.
- The deploy uses the ECS deployment circuit breaker with
  `rollback=true`: if replacement tasks fail to become healthy, ECS rolls
  the service back to the previous task definition on its own, and the
  script fails with a pointer to the rollback command.
- One image build per run, one digest through staging and production: there
  is no drift between what staging tested and what production promotes.
- Rollouts are serialized per branch by the workflow concurrency group and
  never cancelled mid-flight.
