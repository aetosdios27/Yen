output "vpc_id" {
  description = "Staging VPC holding every data-bearing resource."
  value       = aws_vpc.yen_staging.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs across two availability zones. RDS, ElastiCache, and S3 access all resolve inside these."
  value       = aws_subnet.yen_staging_private[*].id
}

output "postgres_endpoint" {
  description = "RDS writer endpoint. Reachable only from inside the staging VPC."
  value       = aws_db_instance.yen_staging.address
}

output "postgres_master_secret_arn" {
  description = "Secrets Manager ARN holding the RDS managed master password. Values never appear in this repo or in Terraform state."
  value       = aws_db_instance.yen_staging.master_user_secret[0].secret_arn
}

output "redis_primary_endpoint" {
  description = "ElastiCache primary configuration endpoint over TLS (rediss://). Reachable only from inside the staging VPC."
  value       = aws_elasticache_replication_group.yen_staging.primary_endpoint_address
}

output "bill_evidence_bucket_name" {
  description = "Private, versioned S3 bucket holding scanned bill evidence."
  value       = aws_s3_bucket.yen_staging_bill_evidence.id
}

output "infra_kms_key_arn" {
  description = "General encryption key backing RDS, Redis, and bill evidence."
  value       = aws_kms_key.yen_staging_infra.arn
}

output "chain_publication_kms_key_arn" {
  description = "Chain publication signing key. Signing is restricted to the anchoring worker role by key policy."
  value       = aws_kms_key.yen_staging_chain_publication.arn
}

output "anchoring_worker_role_arn" {
  description = "Queue anchoring worker role. The only principal allowed to sign chain publications."
  value       = aws_iam_role.yen_staging_anchoring_worker.arn
}

output "infra_plan_role_arn" {
  description = "Role for the infra plan workflow to assume via GitHub OIDC. Configure as the AWS_PLAN_ROLE_ARN repository variable."
  value       = aws_iam_role.yen_staging_infra_plan.arn
}
