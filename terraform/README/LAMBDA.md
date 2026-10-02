# Understanding `lambda.tf` — Step by Step

This file defines **one AWS Lambda function** plus everything it needs to run: its code, permissions, logging, and configuration. It's written in Terraform (Infrastructure as Code).

Let me walk through it section by section.

---

## Section 1: Packaging the Lambda Code

### The problem
AWS Lambda needs a **zip file** of your backend code with its production dependencies (`node_modules`) included. Tools like SAM do this automatically — **Terraform does not**.

### Step 1 — Install dependencies
```hcl
resource "null_resource" "npm_install" { ... }
```
- `null_resource` = a "fake" resource that doesn't create any cloud infrastructure. It's used purely to **run a script**.
- `triggers` = tells Terraform *when* to re-run this. Here it re-runs whenever `package-lock.json` (or `package.json`) changes.
- `provisioner "local-exec"` = runs a shell command **on your machine**:
  ```
  npm install --omit=dev --no-audit --no-fund
  ```
  - `--omit=dev` → only install production dependencies (skip dev tools).
  - Runs inside the `../backend` folder.

### Step 2 — Zip the code
```hcl
data "archive_file" "lambda_zip" { ... }
```
- `data` = "read-only" lookup, not something Terraform creates/manages as infrastructure.
- Zips the `../backend` folder into `build/cloudmentor-api.zip`.
- `excludes` = skips local/dev-only files (events, `.env` samples, `.npmrc`).
- `depends_on` = **wait for `npm install` to finish** before zipping (otherwise `node_modules` might be missing).

**Analogy:** First run `npm install`, then zip the folder — in that order.

---

## Section 2: IAM Role & Permissions

Lambda needs permission to:
1. Write logs to CloudWatch
2. Read/write DynamoDB
3. Read/write S3

SAM gives you shortcuts like `DynamoDBCrudPolicy`. Terraform has **no shortcuts**, so this code writes them out manually.

### 2a. Who can *be* the Lambda? (Trust policy)
```hcl
data "aws_iam_policy_document" "lambda_assume_role"
resource "aws_iam_role" "lambda_exec"
```
- Creates an IAM **role**.
- The assume-role policy says: *"The Lambda service (`lambda.amazonaws.com`) is allowed to use this role."*
- Without this, Lambda can't assume the role at all.

### 2b. Basic execution (logging)
```hcl
resource "aws_iam_role_policy_attachment" "lambda_basic_execution"
```
Attaches AWS's managed policy `AWSLambdaBasicExecutionRole` — gives permission to write to CloudWatch Logs.

### 2c. DynamoDB CRUD
```hcl
data "aws_iam_policy_document" "lambda_dynamodb_crud"
resource "aws_iam_role_policy" "lambda_dynamodb_crud"
```
- Grants actions: `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `Scan`, plus batch and describe.
- **Limited scope** (`resources`): only your one table `cloudmentor_table` and its indexes (`/index/*`). Not "all DynamoDB tables" — good security practice (least privilege).

### 2d. S3 CRUD
```hcl
data "aws_iam_policy_document" "lambda_s3_crud"
resource "aws_iam_role_policy" "lambda_s3_crud"
```
- Grants: `GetObject`, `PutObject`, `DeleteObject`, `ListBucket`.
- Scoped to `materials` bucket (both the bucket itself for `ListBucket`, and `/*` for objects).

---

## Section 3: CloudWatch Log Group

```hcl
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
}
```
- Lambda logs go to a group named `/aws/lambda/<function-name>`.
- If you **don't** create it explicitly, Lambda auto-creates it with **infinite retention** (logs never deleted → costs grow forever).
- By creating it first with `retention_in_days`, logs auto-expire. Cost control + hygiene.

---

## Section 4: The Lambda Function Itself

```hcl
resource "aws_lambda_function" "cloudmentor_api"
```
This is the main event. Key fields:

| Field | Meaning |
|---|---|
| `function_name` | From a local variable |
| `filename` | The zip built in Section 1 |
| `source_code_hash` | Fingerprint of the zip — **if code changes, Lambda redeploys** |
| `role` | IAM role from Section 2 |
| `handler` | Entry point: `src/app.handler` → file `src/app.js`, exported function `handler` |
| `runtime` | `nodejs22.x` |
| `architectures` | `arm64` (Graviton — cheaper + faster than x86) |
| `timeout` | 30 seconds max execution |
| `memory_size` | 512 MB RAM (also scales CPU) |

### Tracing
```hcl
tracing_config { mode = "Active" }
```
Enables **AWS X-Ray** — records requests through the Lambda for debugging/performance.

### Environment variables
```hcl
environment { variables = { ... } }
```
Runtime config passed to your Node code:
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_MODE` — OpenAI config
- `TABLE_NAME` — DynamoDB table name (Terraform fills in automatically)
- `MATERIALS_BUCKET` — S3 bucket name
- `CORS_ORIGIN` — allowed frontend origin
- `STORAGE_MODE = "s3"` — hardcoded

### `depends_on`
```hcl
depends_on = [
  aws_cloudwatch_log_group.lambda_logs,
  aws_iam_role_policy_attachment.lambda_basic_execution,
  aws_iam_role_policy.lambda_dynamodb_crud,
  aws_iam_role_policy.lambda_s3_crud,
]
```
**Create these first, then the Lambda.** This avoids race conditions where Lambda tries to start before it has logs or permissions.

---

## Big Picture Flow

```
1. npm install  ──►  zip backend/
                        │
2. IAM role  +  policies (logs, DynamoDB, S3)
                        │
3. CloudWatch log group (with retention)
                        │
4. Create Lambda ──────┘
   - uses the zip
   - assumes the role
   - logs to the group
   - gets env vars (table, bucket, API keys)
```

---

## Why This File Exists (context from comments)

The original project used **SAM**, which:
- Runs `sam build` (auto `npm install` + zip)
- Expands `Policies:` shortcuts into real IAM policies

Since the project moved to **Terraform**, this file **manually recreates all of that**:
- `null_resource` + `archive_file` → replaces `sam build`
- Explicit IAM policies → replaces SAM `Policies:` shortcuts

That's the whole story of `lambda.tf`. 🎯