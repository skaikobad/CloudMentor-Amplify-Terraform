#!/usr/bin/env bash
# One-time setup: creates the S3 bucket + DynamoDB lock table Terraform uses
# to store remote state. Run this once per AWS account/region before the
# first `terraform init` (locally or in GitHub Actions).
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-southeast-1}"
TF_STATE_BUCKET="${TF_STATE_BUCKET:-}"
TF_STATE_LOCK_TABLE="${TF_STATE_LOCK_TABLE:-cloudmentor-tf-locks}"

if [[ -z "$TF_STATE_BUCKET" ]]; then
  echo "TF_STATE_BUCKET is required. Example:" >&2
  echo "AWS_REGION=ap-southeast-1 TF_STATE_BUCKET=cloudmentor-tfstate-yourname ./scripts/create-tf-state-backend.sh" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is not installed or not in PATH." >&2
  exit 1
fi

echo "==> Creating Terraform state bucket: $TF_STATE_BUCKET in $AWS_REGION"
if aws s3api head-bucket --bucket "$TF_STATE_BUCKET" 2>/dev/null; then
  echo "Bucket already exists or is already accessible: $TF_STATE_BUCKET"
else
  if [[ "$AWS_REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$TF_STATE_BUCKET" --region "$AWS_REGION"
  else
    aws s3api create-bucket \
      --bucket "$TF_STATE_BUCKET" \
      --region "$AWS_REGION" \
      --create-bucket-configuration LocationConstraint="$AWS_REGION"
  fi
fi

aws s3api put-bucket-versioning \
  --bucket "$TF_STATE_BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-public-access-block \
  --bucket "$TF_STATE_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption \
  --bucket "$TF_STATE_BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

echo "==> Creating Terraform lock table: $TF_STATE_LOCK_TABLE"
if aws dynamodb describe-table --table-name "$TF_STATE_LOCK_TABLE" --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "DynamoDB lock table already exists: $TF_STATE_LOCK_TABLE"
else
  aws dynamodb create-table \
    --table-name "$TF_STATE_LOCK_TABLE" \
    --region "$AWS_REGION" \
    --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH
  aws dynamodb wait table-exists --table-name "$TF_STATE_LOCK_TABLE" --region "$AWS_REGION"
fi

cat <<OUT

Done.
Use these values as GitHub secrets (or -backend-config flags locally):
TF_STATE_BUCKET=$TF_STATE_BUCKET
TF_STATE_KEY=cloudmentor/terraform.tfstate
TF_STATE_LOCK_TABLE=$TF_STATE_LOCK_TABLE
AWS_REGION=$AWS_REGION
OUT
