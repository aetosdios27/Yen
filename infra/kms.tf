# -----------------------------------------------------------------------------
# KMS
#
# Two keys with strictly separated duties:
#
# 1. yen-staging-infra: general encryption key for RDS, ElastiCache, and
#    bill evidence objects. Account-scoped admin via the root principal;
#    IAM policies then delegate day to day use.
#
# 2. yen-staging-chain-publication: signing key for chain publication.
#    Its key policy is deliberately restrictive: the ONLY principal that
#    can perform signing operations is the queue anchoring worker role.
#    An explicit Deny on kms:Sign excludes every other principal in the
#    account, including the account root and any administrator role,
#    because explicit Deny overrides Allow in the same or any attached
#    IAM policy. An administrator who wants to sign would have to first
#    edit the key policy itself, which is a CloudTrail-auditable mutation
#    and leaves no silent path to re-signing or key exfiltration.
# -----------------------------------------------------------------------------

resource "aws_kms_key" "yen_staging_infra" {
  description             = "Yen staging general encryption key for RDS, ElastiCache, and bill evidence"
  deletion_window_in_days = var.kms_deletion_window_days
  enable_key_rotation     = true

  tags = {
    Name = "yen-${var.environment}-infra"
  }
}

resource "aws_kms_alias" "yen_staging_infra" {
  name          = "alias/yen-${var.environment}-infra"
  target_key_id = aws_kms_key.yen_staging_infra.key_id
}

resource "aws_iam_role" "yen_staging_anchoring_worker" {
  name        = "yen-${var.environment}-anchoring-worker"
  description = "Queue anchoring worker. Sole principal allowed to sign chain publications."

  # The worker runtime is out of scope for this stack (YEN-17 covers data
  # plane infrastructure only). The trust policy admits the two compute
  # surfaces the runtime will land on; the key policy below, not IAM
  # permissions, is what gates signing.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = [
            "ec2.amazonaws.com",
            "ecs-tasks.amazonaws.com",
          ]
        }
        Action = "sts:AssumeRole"
      },
    ]
  })

  tags = {
    Name = "yen-${var.environment}-anchoring-worker"
  }
}

resource "aws_kms_key" "yen_staging_chain_publication" {
  description              = "Yen staging chain publication signing key. Usage restricted to the anchoring worker."
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_NIST_P256"
  deletion_window_in_days  = var.kms_deletion_window_days
  enable_key_rotation      = false

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "KeyAdmin"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "ChainPublicationSignerOnly"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.yen_staging_anchoring_worker.arn
        }
        Action = [
          "kms:Sign",
          "kms:Verify",
          "kms:GetPublicKey",
          "kms:DescribeKey",
        ]
        Resource = "*"
      },
      {
        # Explicit Deny beats every Allow, including the root admin
        # statement above and any IAM policy attached anywhere in the
        # account. Signing is therefore physically unreachable for any
        # principal other than the anchoring worker role.
        Sid       = "DenySignToEveryoneElse"
        Effect    = "Deny"
        Principal = "*"
        Action    = "kms:Sign"
        Resource  = "*"
        Condition = {
          StringNotEquals = {
            "aws:PrincipalArn" = aws_iam_role.yen_staging_anchoring_worker.arn
          }
        }
      },
    ]
  })

  tags = {
    Name = "yen-${var.environment}-chain-publication"
  }
}

resource "aws_kms_alias" "yen_staging_chain_publication" {
  name          = "alias/yen-${var.environment}-chain-publication"
  target_key_id = aws_kms_key.yen_staging_chain_publication.key_id
}

data "aws_caller_identity" "current" {}
