# -----------------------------------------------------------------------------
# HTTP API (equivalent of AWS::Serverless::HttpApi)
# -----------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "cloudmentor_http_api" {
  name          = "${var.stack_name}-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.cors_origin]
    allow_headers = [
      "Content-Type",
      "Authorization",
      "x-amz-date",
      "x-amz-security-token",
      "x-amz-content-sha256",
    ]
    allow_methods = ["GET", "POST", "PUT", "OPTIONS"]
    max_age       = 600
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.cloudmentor_http_api.id
  name        = "$default"
  auto_deploy = true
}

# -----------------------------------------------------------------------------
# Single Lambda proxy integration shared by every route (same pattern SAM used:
# one function fronts every path).
# -----------------------------------------------------------------------------
resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.cloudmentor_http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.cloudmentor_api.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "routes" {
  for_each = local.routes

  api_id    = aws_apigatewayv2_api.cloudmentor_http_api.id
  route_key = "${each.value.method} ${each.value.path}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_lambda_permission" "apigw_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cloudmentor_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.cloudmentor_http_api.execution_arn}/*/*"
}
