# -----------------------------------------------------------------------------
# Bill evidence storage
#
# Private S3 bucket for scanned bill evidence. Every write is versioned so
# a tampered or deleted object leaves the previous version recoverable,
# which is what makes the ledger's evidence trail auditable. All public
# access is blocked at the bucket level; the API issues short-lived
# presigned URLs for club members.
#
# Signed URL note: the bucket uses SSE-KMS. Presigned URL recipients need
# kms:Decrypt on the general key, so the API grants a temporary grant to
# the member session when it issues a URL (or proxies the download). The
# key policy for the general key allows the account root, so the API role
# receives decrypt access through IAM.
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "yen_staging_bill_evidence" {
  bucket = var.bill_evidence_bucket_name

  tags = {
    Name = "yen-${var.environment}-bill-evidence"
  }
}

resource "aws_s3_bucket_versioning" "yen_staging_bill_evidence" {
  bucket = aws_s3_bucket.yen_staging_bill_evidence.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "yen_staging_bill_evidence" {
  bucket = aws_s3_bucket.yen_staging_bill_evidence.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "yen_staging_bill_evidence" {
  bucket = aws_s3_bucket.yen_staging_bill_evidence.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "yen_staging_bill_evidence" {
  bucket = aws_s3_bucket.yen_staging_bill_evidence.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.yen_staging_infra.arn
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "yen_staging_bill_evidence" {
  bucket = aws_s3_bucket.yen_staging_bill_evidence.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    # An empty filter applies the rule to every object in the bucket.
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.bill_evidence_noncurrent_expiration_days
    }
  }
}

# Defense in depth on top of the public access block: deny any request
# that is not made over TLS.
resource "aws_s3_bucket_policy" "yen_staging_bill_evidence" {
  bucket = aws_s3_bucket.yen_staging_bill_evidence.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.yen_staging_bill_evidence.arn,
          "${aws_s3_bucket.yen_staging_bill_evidence.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
    ]
  })
}
