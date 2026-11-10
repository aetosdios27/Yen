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
