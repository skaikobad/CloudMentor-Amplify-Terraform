terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Remote state backend (recommended for CI/CD since GitHub Actions runners
  # are ephemeral and have no local state between runs).
  #
  # This is a partial configuration on purpose: the actual bucket/key/table
  # are supplied at `terraform init` time via -backend-config flags (see the
  # GitHub Actions workflow and scripts/create-tf-state-backend.sh).
  #
  # For local/manual use you can either:
  #   1. Run `terraform init -backend-config=...` the same way CI does, or
  #   2. Comment this block out to fall back to local state (./terraform.tfstate)
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "CloudMentor"
      ManagedBy = "Terraform"
      Stack     = var.stack_name
    }
  }
}
