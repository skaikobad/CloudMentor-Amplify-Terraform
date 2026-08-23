resource "aws_dynamodb_table" "cloudmentor_table" {
  name         = "${var.stack_name}-history"
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "userId"
  range_key = "createdAtId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "createdAtId"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }
}
