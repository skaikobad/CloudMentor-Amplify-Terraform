# Output the bucket name so we can use it in the next part
output "TF_STATE_BUCKET" {
  value = aws_s3_bucket.terraform_state.bucket
}

output "TF_STATE_KEY" {
  value = cloudmentor/terraform.tfstate
}
 
output "TF_STATE_LOCK_TABLE" {
  value = aws_dynamodb_table.terraform_locks.name
}
