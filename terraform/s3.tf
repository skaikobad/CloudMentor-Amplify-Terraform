# Bucket name is left for AWS/Terraform to auto-generate (a random, unique
# name), matching the behavior of the original CloudFormation template, which
# never set an explicit BucketName either.
resource "aws_s3_bucket" "materials" {
  bucket_prefix = "${var.stack_name}-materials-"
}

resource "aws_s3_bucket_public_access_block" "materials" {
  bucket = aws_s3_bucket.materials.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "materials" {
  bucket = aws_s3_bucket.materials.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "materials" {
  bucket = aws_s3_bucket.materials.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = [var.cors_origin]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
