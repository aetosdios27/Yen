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

| Variable | Meaning |
| --- | --- |
| `OIDC_ROLE_ARN` | IAM role the job assumes (per environment) |
| `AWS_REGION` | Cloud region |
| `ECR_REPOSITORY` | ECR repository for the API image |
| `ECS_CLUSTER` | ECS cluster for the environment |
| `ECS_SERVICE` | ECS service backing the API |
| `ECS_CONTAINER_NAME` | Container name inside the task definition |
| `ECS_MIGRATION_TASK_DEFINITION` | Task definition family for migration tasks |
| `ECS_SUBNETS` | Comma separated subnet ids for one-off tasks |
| `ECS_SECURITY_GROUPS` | Comma separated security group ids |
| `API_BASE_URL` | Public HTTPS base URL, used by the smoke probes |

And the environment secret:

| Secret | Meaning |
| --- | --- |
| `MIGRATION_SECRET_ID` | Secrets Manager id holding the migration `DATABASE_URL` |
