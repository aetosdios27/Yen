# ADR 0004: Staging Hosting and Cost Model

Status: Proposed for YEN-17
Date: 2026-11-10

## Context

Yen holds club membership records, financial ledgers, and scanned bill evidence for Indian clubs. Two hard constraints govern where this data lives:

1. **DPDP compliance**: the Digital Personal Data Protection Act requires that personal data of Indian data principals be handled with Indian residency guarantees. Storing club and financial data outside India adds a cross-border transfer question that the project does not need to answer yet.
2. **Banking partner requirements**: banking and payment partners evaluating Yen expect financial records to reside in India. A staging environment outside India cannot be shown to them as a faithful preview.

Additionally, staging must mirror production architecture closely enough that behavior observed in staging (queue latencies, failover semantics, network isolation, KMS-gated signing) is predictive of production behavior.

## Decision Summary

1. **Provider and region**: Amazon Web Services, region `ap-south-1` (Mumbai). All data-bearing resources (RDS, ElastiCache, S3) are regional resources and store data exclusively in Mumbai.
2. **Infrastructure as Code**: Terraform under `infra/`, pinned to `ap-south-1` by variable validation. The region cannot be drifted away from India without failing the variable check.
3. **Environment parity**: staging uses the same managed services, engine versions, and network posture that production will use: PostgreSQL 16 on RDS, Redis 7.1 on ElastiCache, S3 with versioning and SSE-KMS, KMS with separated duties. Only the size tier differs (micro instances, single-AZ).
4. **Private networking**: no internet gateway, no NAT gateway, no public subnets. RDS and ElastiCache accept traffic only from inside the VPC. An S3 gateway endpoint keeps bill evidence traffic on the AWS backbone at no cost.
5. **No static cloud credentials**: the CI plan workflow authenticates through GitHub OIDC by assuming a read-only IAM role (`infra_plan_role_arn` output). There is no apply role for CI; applies are manual by an operator.
6. **CI is plan-only**: `.github/workflows/infra-plan.yml` runs `terraform fmt -check`, `terraform validate`, and `terraform plan` on every PR touching `infra/`, posting the plan as a PR comment. No workflow path can apply.

## Alternatives Considered

| Option                                      | Verdict | Reason                                                                                                         |
| :------------------------------------------ | :------ | :------------------------------------------------------------------------------------------------------------- |
| AWS ap-south-1 (Mumbai)                     | Chosen  | India residency, mature managed Postgres and Redis, existing Terraform AWS provider ecosystem                   |
| GCP asia-south2 (Delhi)                     | Rejected | Cloud SQL and Memorystore are adequate, but the team's existing infrastructure tooling is AWS-first             |
| Azure Central India                         | Rejected | India residency holds, but Azure Database and Cache tiering is less granular at the micro scale Yen staging needs |
| Self-managed VM in India (Hetzner/AWS EC2)  | Rejected | Cheaper, but loses PITR, automated backups, encryption at rest defaults, and managed failover; parity breaks    |
| Single Docker host for staging              | Rejected | Does not mirror production; would validate a topology Yen will never run in production                         |

## Cost Model (Staging, ap-south-1, Monthly)

All prices are AWS list prices for ap-south-1, converted at an assumed INR 88 per USD. Figures are approximate and should be re-verified against the AWS Pricing Calculator before production; they are the basis for the INR 5,000/month staging budget.

| Item                                             | Spec                                   | Monthly USD | Monthly INR (approx) |
| :----------------------------------------------- | :------------------------------------- | ----------: | -------------------: |
| RDS PostgreSQL 16, db.t4g.micro, single-AZ       | ~730 hours at USD 0.022/hr             |      16.06  |               1,413  |
| RDS gp3 storage                                  | 20 GiB at USD 0.13/GiB                 |       2.60  |                 229  |
| RDS automated backups (PITR, 14 day retention)   | Free up to 100% of allocated storage   |       0.00  |                   0  |
| RDS managed master password secret               | 1 secret in Secrets Manager            |       0.40  |                  35  |
| ElastiCache Redis 7.1, cache.t4g.micro           | ~730 hours at USD 0.0208/hr            |      15.18  |               1,336  |
| ElastiCache snapshots (5 day retention)          | Within 20 GiB working set              |       0.00  |                   0  |
| S3 bill evidence (versioned, SSE-KMS)            | 5 GiB Standard at USD 0.025/GiB        |       0.13  |                  11  |
| S3 requests and noncurrent version storage       | Low staging traffic                    |       0.05  |                   4  |
| S3 gateway endpoint                              | Gateway endpoints are free             |       0.00  |                   0  |
| KMS keys                                         | 2 customer managed keys at USD 1.00    |       2.00  |                 176  |
| KMS API calls                                    | Low staging volume                     |       0.05  |                   4  |
| VPC, subnets, route tables, security groups      | Free components; no NAT gateway        |       0.00  |                   0  |
| CloudWatch basic monitoring                      | Free tier metrics                      |       0.00  |                   0  |
| **Total**                                        |                                        |  **36.47**  |          **3,208**   |

**Budget headroom**: the model lands at roughly INR 3,210, about 64% of the INR 5,000 ceiling. The headroom absorbs INR movement and small usage growth.

### What would break the budget

These are deliberately excluded, and any of them moves staging out of budget or close to it:

| Change                                        | Added cost (approx)        |
| :-------------------------------------------- | :------------------------- |
| NAT gateway (one, plus data processing)        | +USD 33/mo (~INR 2,900)    |
| Multi-AZ RDS                                   | Doubles the RDS line       |
| db.t4g.small instead of db.t4g.micro           | +USD 29/mo (~INR 2,550)    |
| Multi-AZ ElastiCache with replica              | Doubles the Redis line     |
| Performance Insights on RDS                    | +USD 15 to 30/mo           |

Production will need at least multi-AZ and a NAT gateway for compute egress; those costs are production decisions and out of scope here. Staging compute (the API and worker runtime) is a separate track (YEN-17 covers the data plane: VPC, database, Redis, storage, KMS); if compute lands on EC2 or ECS inside this VPC, its instance cost is evaluated then, and the S3 gateway endpoint already removes the need for NAT on the S3 path.

## Environment Parity

| Dimension          | Staging (this stack)                        | Production intent                     |
| :----------------- | :------------------------------------------ | :------------------------------------ |
| Region             | ap-south-1, enforced by variable validation | ap-south-1                            |
| Database engine    | PostgreSQL 16 (RDS)                         | PostgreSQL 16 (RDS)                   |
| Database HA        | Single-AZ                                   | Multi-AZ                              |
| PITR               | 14 day retention                            | 35 day retention (max)                |
| Queue cache        | Redis 7.1 (ElastiCache), TLS, encrypted     | Redis 7.1 (ElastiCache), TLS, encrypted |
| Redis topology     | Single node, snapshots                      | Replication group with failover       |
| Bill evidence      | S3, versioned, SSE-KMS, private             | Same, plus higher lifecycle bounds    |
| Chain signing      | KMS ECC P256, anchoring worker only         | Same key policy shape                 |
| Network            | Private-only VPC, no IGW, no NAT            | Same posture, plus guarded compute egress |
| Credentials        | RDS-managed password in Secrets Manager     | Same                                  |
| CI access          | OIDC read-only plan role                    | Same                                  |

Anything behaviorally observable (TLS-only endpoints, private DNS, KMS gating, versioned writes) is identical between staging and production. Only capacity and redundancy tiers differ.

## Validation Notes

Terraform CLI is not installed on the authoring machine, so plan execution is delegated entirely to CI:

- `terraform fmt -check -recursive` and `terraform validate` run in the `static-checks` job of `.github/workflows/infra-plan.yml` on every PR touching `infra/`, with no AWS access.
- `terraform plan` against the real account runs in the `plan` job when the `AWS_PLAN_ROLE_ARN` repository variable is set, authenticated via OIDC.
- A committed `infra/.terraform.lock.hcl` pins provider versions so CI and operators resolve identical providers.

Manual applies are performed by an operator from a trusted machine with an assumed role; CI cannot apply by construction.
