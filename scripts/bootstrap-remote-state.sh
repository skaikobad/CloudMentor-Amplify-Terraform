#!/usr/bin/env bash
#
# bootstrap-remote-state.sh
#
# Runs `terraform init` and `terraform apply` against the bootstrap/
# directory to create the S3 bucket + DynamoDB table used for Terraform
# remote state.
#
# Location: scripts/bootstrap-remote-state.sh
# Usage:    ./scripts/bootstrap-remote-state.sh
#
# NOTE: terraform apply always runs with -auto-approve — no interactive
# confirmation prompt. Make sure you trust bootstrap/*.tf before running.

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve paths (works no matter where the script is invoked from)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." &>/dev/null && pwd)"
BOOTSTRAP_DIR="${REPO_ROOT}/bootstrap"

# ---------------------------------------------------------------------------
# Colors for output
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if ! command -v terraform &>/dev/null; then
  error "terraform is not installed or not on PATH."
  exit 1
fi

if [ ! -d "${BOOTSTRAP_DIR}" ]; then
  error "bootstrap directory not found at: ${BOOTSTRAP_DIR}"
  exit 1
fi

if ! command -v aws &>/dev/null; then
  warn "aws CLI not found — skipping credentials check. Make sure your AWS credentials are configured (env vars, profile, etc.)."
elif ! aws sts get-caller-identity &>/dev/null; then
  error "AWS credentials are not configured or are invalid. Run 'aws configure' or set your credentials, then retry."
  exit 1
fi

# ---------------------------------------------------------------------------
# Run Terraform
# ---------------------------------------------------------------------------
info "Using bootstrap directory: ${BOOTSTRAP_DIR}"
cd "${BOOTSTRAP_DIR}"

info "Running terraform init..."
terraform init

info "Running terraform validate..."
terraform validate

info "Running terraform apply (auto-approved)..."
terraform apply -auto-approve

info "Bootstrap complete. Outputs:"
terraform output