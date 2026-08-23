variable "aws_region" {
  description = "AWS region to deploy CloudMentor into."
  type        = string
  default     = "ap-southeast-1"
}

variable "stack_name" {
  description = "Logical stack/project name, used to prefix resource names (equivalent to the old SAM_STACK_NAME)."
  type        = string
  default     = "cloudmentor-prod"
}

variable "openai_api_key" {
  description = "OpenAI API key. Use a real key for ai_mode=openai. For ai_mode=mock, the placeholder is ignored."
  type        = string
  sensitive   = true
  default     = "mock-placeholder-no-openai-key"
}

variable "openai_model" {
  description = "OpenAI text model to use."
  type        = string
  default     = "gpt-4.1-mini"
}

variable "ai_mode" {
  description = "Use 'openai' for real AI calls or 'mock' for classroom demos without API billing."
  type        = string
  default     = "openai"

  validation {
    condition     = contains(["openai", "mock"], var.ai_mode)
    error_message = "ai_mode must be either \"openai\" or \"mock\"."
  }
}

variable "cors_origin" {
  description = "Allowed frontend origin, i.e. the AWS Amplify app URL (e.g. https://main.YOUR_AMPLIFY_APP_ID.amplifyapp.com). Use * for classroom demo only."
  type        = string
  default     = "*"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention period for the Lambda function."
  type        = number
  default     = 14
}
