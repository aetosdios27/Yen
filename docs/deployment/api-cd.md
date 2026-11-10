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
