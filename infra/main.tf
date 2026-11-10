# Yen staging infrastructure (YEN-17).
#
# Target region: ap-south-1 (Mumbai). Indian club and financial data must
# remain in India for DPDP compliance, banking partner requirements, and
# latency. See docs/adr/0004-staging-hosting-cost.md.
#
# All data-bearing resources (RDS, ElastiCache, S3) live in private subnets
# with no internet gateway and no NAT gateway. This stack is plan-validated
# on every PR that touches infra/ by .github/workflows/infra-plan.yml.
# Applies are manual, performed by an operator from a trusted machine using
# an assumed role; CI never applies.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "yen"
      Environment = var.environment
      ManagedBy   = "terraform"
      Issue       = "YEN-17"
    }
  }
}

# -----------------------------------------------------------------------------
# Networking: private-only VPC
#
# Staging mirrors the production posture: no internet gateway, no NAT
# gateway, and no public subnets. RDS and ElastiCache are reachable only
# from inside the VPC. The S3 gateway endpoint is free and lets bill
# evidence traffic stay on the AWS backbone without a NAT hop.
# -----------------------------------------------------------------------------

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "yen_staging" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "yen-${var.environment}-vpc"
  }
}

resource "aws_subnet" "yen_staging_private" {
  count = length(var.private_subnet_cidrs)

  vpc_id            = aws_vpc.yen_staging.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "yen-${var.environment}-private-${count.index + 1}"
  }
}

# Explicit route table with only the local route. Nothing here can reach
# the internet, and nothing on the internet can reach anything here.
resource "aws_route_table" "yen_staging_private" {
  vpc_id = aws_vpc.yen_staging.id

  tags = {
    Name = "yen-${var.environment}-private"
  }
}

resource "aws_route_table_association" "yen_staging_private" {
  count = length(aws_subnet.yen_staging_private)

  subnet_id      = aws_subnet.yen_staging_private[count.index].id
  route_table_id = aws_route_table.yen_staging_private.id
}

resource "aws_vpc_endpoint" "bill_evidence_s3_gateway" {
  vpc_id            = aws_vpc.yen_staging.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.yen_staging_private.id]

  tags = {
    Name = "yen-${var.environment}-s3-gateway"
  }
}

# -----------------------------------------------------------------------------
# CI access via OIDC, no static credentials
#
# The infra plan workflow in .github/workflows/infra-plan.yml authenticates
# by exchanging a GitHub Actions OIDC token for this role. The trust policy
# is scoped to this repository on pull_request and main only. The role is
# read-only, so a PR can produce a plan but can never change anything.
# There is no apply role for CI; applies are manual by an operator.
# -----------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = {
    Name = "yen-${var.environment}-github-oidc"
  }
}

resource "aws_iam_role" "yen_staging_infra_plan" {
  name        = "yen-${var.environment}-infra-plan"
  description = "GitHub Actions OIDC role for terraform plan on infra PRs. Read only."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = var.github_oidc_allowed_subconditions
          }
        }
      },
    ]
  })

  tags = {
    Name = "yen-${var.environment}-infra-plan"
  }
}

resource "aws_iam_role_policy_attachment" "yen_staging_infra_plan_readonly" {
  role       = aws_iam_role.yen_staging_infra_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}
