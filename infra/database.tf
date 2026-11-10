# -----------------------------------------------------------------------------
# Managed PostgreSQL 16
#
# pg-boss and the ledger both run on Postgres 16 (see ADR 0002), so staging
# runs the same engine and major version as production. The master password
# is managed by RDS and rotated into Secrets Manager; no credential is ever
# committed or passed through Terraform variables.
# -----------------------------------------------------------------------------

resource "aws_db_subnet_group" "yen_staging" {
  name        = "yen-${var.environment}-db"
  description = "Private subnets for the staging Postgres instance"
  subnet_ids  = aws_subnet.yen_staging_private[*].id

  tags = {
    Name = "yen-${var.environment}-db"
  }
}

resource "aws_security_group" "yen_staging_postgres" {
  name        = "yen-${var.environment}-postgres"
  description = "Postgres access from inside the staging VPC only"
  vpc_id      = aws_vpc.yen_staging.id

  ingress {
    description = "Postgres from the VPC"
    from_port   = 5432
    to_port     = 5432
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
    Name = "yen-${var.environment}-postgres"
  }
}

resource "aws_db_parameter_group" "yen_staging" {
  name   = "yen-${var.environment}-pg16"
  family = "postgres16"

  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "300000"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = {
    Name = "yen-${var.environment}-pg16"
  }
}

resource "aws_db_instance" "yen_staging" {
  identifier     = "yen-${var.environment}-postgres"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  db_name  = "yen"
  username = "yen_admin"

  # The master password is generated and rotated by RDS and stored in
  # Secrets Manager. Nothing sensitive flows through this repo.
  manage_master_user_password = true

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"

  db_subnet_group_name   = aws_db_subnet_group.yen_staging.name
  vpc_security_group_ids = [aws_security_group.yen_staging_postgres.id]
  parameter_group_name   = aws_db_parameter_group.yen_staging.name
  multi_az               = false
  publicly_accessible    = false

  storage_encrypted = true
  copy_tags_to_snapshot = true

  # Point-in-time recovery: retained PITR window plus a fixed maintenance
  # and backup window outside Indian business hours (IST).
  backup_retention_period = var.db_backup_retention_days
  backup_window           = "18:00-19:00"
  maintenance_window      = "sun:19:30-sun:20:30"

  deletion_protection     = true
  skip_final_snapshot     = true
  delete_automated_backups = false

  performance_insights_enabled = false
  auto_minor_version_upgrade   = true

  tags = {
    Name = "yen-${var.environment}-postgres"
  }
}
