# -----------------------------------------------------------------------------
# Managed Redis
#
# Queue processing and distributed locks (ADR 0002 escape hatch to BullMQ,
# and any lock coordination the queue runtime needs) run on ElastiCache
# Redis. The replication group is single node with no failover, which is
# the cheapest shape that still supports snapshots for staging.
#
# transit_encryption_enabled requires TLS connections (rediss://), which
# BullMQ supports natively via the tls option.
# -----------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "yen_staging" {
  name        = "yen-${var.environment}-redis"
  description = "Private subnets for the staging Redis cluster"
  subnet_ids  = aws_subnet.yen_staging_private[*].id
}

resource "aws_security_group" "yen_staging_redis" {
  name        = "yen-${var.environment}-redis"
  description = "Redis access from inside the staging VPC only"
  vpc_id      = aws_vpc.yen_staging.id

  ingress {
    description = "Redis from the VPC"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "Reply traffic is unrestricted inside the VPC"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = {
    Name = "yen-${var.environment}-redis"
  }
}

resource "aws_elasticache_replication_group" "yen_staging" {
  replication_group_id = "yen-${var.environment}-redis"
  description          = "Staging Redis for queue processing and distributed locks"

  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  port                       = 6379
  num_node_groups            = 1
  replicas_per_node_group    = 0
  automatic_failover_enabled = false

  subnet_group_name  = aws_elasticache_subnet_group.yen_staging.name
  security_group_ids = [aws_security_group.yen_staging_redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  snapshot_retention_limit = var.redis_snapshot_retention_days
  snapshot_window          = "18:00-19:00"
  maintenance_window       = "sun:19:30-sun:20:30"

  auto_minor_version_upgrade = true

  tags = {
    Name = "yen-${var.environment}-redis"
  }
}
