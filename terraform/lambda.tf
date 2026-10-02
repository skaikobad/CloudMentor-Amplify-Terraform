# -----------------------------------------------------------------------------
# Package the Lambda function code.
#
# SAM used to run `sam build` to `npm install` production dependencies and zip
# backend/ for us. Terraform doesn't do this automatically, so we run `npm ci`
# ourselves before zipping the backend directory.
# -----------------------------------------------------------------------------
resource "null_resource" "npm_install" {
  triggers = {
    package_lock_hash = fileexists("${path.module}/../backend/package-lock.json") ? filesha256("${path.module}/../backend/package-lock.json") : filesha256("${path.module}/../backend/package.json")
  }

# Terraform runs npm install locally on the GitHub runner (not on AWS)
# This installs the backend's production dependencies into backend/node_modules
# Then archive_file.lambda_zip zips up backend/ (including node_modules) into the Lambda deployment package
  provisioner "local-exec" {
    working_dir = "${path.module}/../backend"
    command     = "npm install --omit=dev --no-audit --no-fund"
  }
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../backend"
  output_path = "${path.module}/build/cloudmentor-api.zip"

  excludes = [
    "events",
    "env.local.example.json",
    "env.production.example.json",
    "env.json",
    ".npmrc",
  ]

  depends_on = [null_resource.npm_install]
}

# -----------------------------------------------------------------------------
# IAM role + policies
#
# SAM's `Policies: [AWSLambdaBasicExecutionRole, DynamoDBCrudPolicy, S3CrudPolicy]`
# are convenience shortcuts that expand into an IAM role and inline policies at
# deploy time. Terraform has no equivalent shortcut, so we recreate the same
# effective permissions explicitly.
# -----------------------------------------------------------------------------

# Define trust policy --> Who can assume the role --> The Lambda service.
data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Create the IAM role and attach the trust policy.
resource "aws_iam_role" "lambda_exec" {
  name               = "${local.function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

# Attach basic Lambda permissions (CloudWatch Logs) to the role.
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Define an inline policy allowing CRUD + Query + Scan + Batch operations on DybamoDB table
# Restrict the policy to the specific table and its indexes.
data "aws_iam_policy_document" "lambda_dynamodb_crud" {
  statement {
    sid = "DynamoDbCrud"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:DescribeTable",
      "dynamodb:ConditionCheckItem",
    ]
    resources = [
      aws_dynamodb_table.cloudmentor_table.arn,
      "${aws_dynamodb_table.cloudmentor_table.arn}/index/*",
    ]
  }
}

# Attach the inline policy to the Lambda's IAM role.
resource "aws_iam_role_policy" "lambda_dynamodb_crud" {
  name   = "${local.function_name}-dynamodb-crud"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_dynamodb_crud.json
}

# Define an inline policy allowing CRUD operations on the S3 bucket
# Restrict the policy to the specific bucket and its objects.
data "aws_iam_policy_document" "lambda_s3_crud" {
  statement {
    sid = "S3Crud"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.materials.arn,
      "${aws_s3_bucket.materials.arn}/*",
    ]
  }
}

# Attach the inline policy to the Lambda's IAM role.
resource "aws_iam_role_policy" "lambda_s3_crud" {
  name   = "${local.function_name}-s3-crud"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_s3_crud.json
}

# Note: aws_iam_role_policy_attachment is used for managed policies, while aws_iam_role_policy is used for inline policies (policy that lives inside the role itself).

# -----------------------------------------------------------------------------
# CloudWatch log group
#
# Created explicitly (with retention) up front so Lambda attaches to it
# instead of implicitly creating an unmanaged, never-expiring log group.
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
}

# -----------------------------------------------------------------------------
# Lambda function
# -----------------------------------------------------------------------------
resource "aws_lambda_function" "cloudmentor_api" {
  function_name = local.function_name
  description   = "CloudMentor Lambda API"

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  role    = aws_iam_role.lambda_exec.arn
  handler = "src/app.handler"
  runtime = "nodejs22.x"

  architectures = ["arm64"]
  timeout       = 30
  memory_size   = 512

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      OPENAI_API_KEY   = var.openai_api_key
      OPENAI_MODEL     = var.openai_model
      AI_MODE          = var.ai_mode
      TABLE_NAME       = aws_dynamodb_table.cloudmentor_table.name
      MATERIALS_BUCKET = aws_s3_bucket.materials.bucket
      CORS_ORIGIN      = var.cors_origin
      STORAGE_MODE     = "s3"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda_logs,
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy.lambda_dynamodb_crud,
    aws_iam_role_policy.lambda_s3_crud,
  ]
}
