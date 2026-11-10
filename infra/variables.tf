variable "aws_region" {
  description = "AWS region for all Yen staging resources. Pinned to Mumbai so club and financial data stays in India."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = var.aws_region == "ap-south-1"
    error_message = "Yen staging is India-resident only. The region must be ap-south-1."
  }
}

variable "environment" {
  description = "Environment label applied to every resource via default tags."
  type        = string
  default     = "staging"
}

variable "vpc_cidr" {
  description = "CIDR block for the staging VPC. Private range only; no public subnets are provisioned."
  type        = string
  default     = "10.40.0.0/16"
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for the private subnets, spread across two availability zones."
  type        = list(string)
  default     = ["10.40.8.0/21", "10.40.16.0/21"]
}

variable "db_instance_class" {
  description = "RDS instance class for staging. db.t4g.micro is the smallest Graviton class and keeps the staging cost model under budget."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Initial RDS storage in GiB. gp3 storage grows automatically up to max_allocated_storage."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling ceiling in GiB. Caps the blast radius of runaway staging growth."
  type        = number
  default     = 100
}

variable "db_backup_retention_days" {
  description = "Point-in-time recovery window in days. Retained backups beyond the allocated storage size bill as backup storage."
  type        = number
  default     = 14

  validation {
    condition     = var.db_backup_retention_days >= 7 && var.db_backup_retention_days <= 35
    error_message = "The PITR window must stay between 7 and 35 days."
  }
}

variable "redis_node_type" {
  description = "ElastiCache node class for staging queue and lock workloads."
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_snapshot_retention_days" {
  description = "Number of daily ElastiCache snapshots to retain."
  type        = number
  default     = 5
}

variable "bill_evidence_bucket_name" {
  description = "Globally unique S3 bucket name holding scanned bill evidence. Override per environment because bucket names are account-global."
  type        = string
  default     = "yen-staging-bill-evidence-ap-south-1"
}

variable "bill_evidence_noncurrent_expiration_days" {
  description = "Days a noncurrent bill evidence object version is kept before expiry. Versioning plus a bounded retention window gives tamper evidence without unbounded storage cost."
  type        = number
  default     = 180
}

variable "kms_deletion_window_days" {
  description = "Pending window before a KMS key deletion completes. Long enough to catch an accidental staging key deletion."
  type        = number
  default     = 30
}

variable "github_oidc_allowed_subconditions" {
  description = "Allowed GitHub OIDC subject conditions for the infra plan role. Scoped to this repository only; PRs get plan, main gets plan for drift checks. No apply role is issued to CI."
  type        = list(string)
  default = [
    "repo:aetosdios27/Yen:pull_request",
    "repo:aetosdios27/Yen:ref:refs/heads/main",
  ]
}
