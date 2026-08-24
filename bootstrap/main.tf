# bootstrap/main.tf
# This creates the S3 bucket and DynamoDB table for our state backend
# IMPORTANT: This bootstrap config uses LOCAL state
 
# Random suffix to make bucket name globally unique
resource "random_id" "suffix" {
  byte_length = 4
}
 
# S3 Bucket for Terraform State
resource "aws_s3_bucket" "terraform_state" {
  bucket = "terraform-state-${random_id.suffix.hex}"
 
  tags = {
    Name    = "Terraform State Bucket"
    Purpose = "Remote State Storage"
  }
}
 
# Enable versioning - keeps history of state changes
resource "aws_s3_bucket_versioning" "state_versioning" {
  bucket = aws_s3_bucket.terraform_state.id
 
  versioning_configuration {
    status = "Enabled"
  }
}

# Enable encryption - state may contain sensitive data!
resource "aws_s3_bucket_server_side_encryption_configuration" "state_encryption" {
  bucket = aws_s3_bucket.terraform_state.id
 
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
 
# Block all public access to state bucket
resource "aws_s3_bucket_public_access_block" "state_public_access" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
 
# DynamoDB table for state locking
# Prevents two people from modifying state simultaneously
resource "aws_dynamodb_table" "terraform_locks" {
  name         = "terraform-state-locks"
  billing_mode = "PAY_PER_REQUEST"  # No capacity planning needed
  hash_key     = "LockID"
 
  attribute {
    name = "LockID"
    type = "S"  # S = String
  }
 
  tags = {
    Name    = "Terraform State Lock Table"
    Purpose = "State Locking"
  }
}