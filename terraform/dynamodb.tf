# -------------------------------------------------------------------------------
# The DynamoDB table is used to store the CloudMentor history data (user interactions,
# course progress, etc.). The table is configured with a composite primary key
# consisting of a hash key (userId) and a range key (createdAtId).
# -------------------------------------------------------------------------------

resource "aws_dynamodb_table" "cloudmentor_table" {
  name         = "${var.stack_name}-history"
  billing_mode = "PAY_PER_REQUEST"  # Great for spiky or unpredictable traffic

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
