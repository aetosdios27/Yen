output "vpc_id" {
  description = "Staging VPC holding every data-bearing resource."
  value       = aws_vpc.yen_staging.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs across two availability zones. RDS, ElastiCache, and S3 access all resolve inside these."
  value       = aws_subnet.yen_staging_private[*].id
}
