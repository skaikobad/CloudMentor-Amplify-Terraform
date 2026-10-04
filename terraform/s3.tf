# -------------------------------------------------------------------------------
# The bucket is used to store the CloudMentor materials (PDFs, images, etc.) that
# the Lambda function serves to the frontend. The bucket is private, and the
# Lambda function is granted an inline policy allowing it to read/write objects
# in the bucket. The bucket is also configured with CORS to allow the frontend
# to access the materials.
# -------------------------------------------------------------------------------

# Create an S3 bucket
resource "aws_s3_bucket" "materials" {
  bucket_prefix = "${var.stack_name}-materials-"
}

# Create a public access block to prevent public access to the bucket
resource "aws_s3_bucket_public_access_block" "materials" {
  bucket = aws_s3_bucket.materials.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable server-side encryption for the S3 bucket using AES256
resource "aws_s3_bucket_server_side_encryption_configuration" "materials" {
  bucket = aws_s3_bucket.materials.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Define cors configuration for the S3 bucket to allow the frontend to access the materials
# Restrict the allowed origins to the frontend's domain. This is done to prevent unauthorized access to the materials.
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
