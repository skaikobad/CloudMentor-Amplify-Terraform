output "api_base_url" {
  description = "Base URL for the API Gateway HTTP API"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "table_name" {
  description = "DynamoDB table name"
  value       = aws_dynamodb_table.cloudmentor_table.name
}

output "materials_bucket_name" {
  description = "Private S3 bucket for uploaded CloudMentor study materials"
  value       = aws_s3_bucket.materials.bucket
}

output "lambda_function_name" {
  description = "Name of the deployed Lambda function"
  value       = aws_lambda_function.cloudmentor_api.function_name
}
