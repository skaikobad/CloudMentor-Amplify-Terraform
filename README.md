# CloudMentor Prod

CloudMentor is a teaching-friendly AI learning assistant built with React, AWS Lambda, API Gateway, S3, DynamoDB, CloudWatch, and GitHub Actions CI/CD.

This **prod** version is designed for this deployment model:

```text
GitHub push to main
  -> GitHub Actions
  -> Terraform deploys backend infrastructure
  -> Lambda + API Gateway + S3 + DynamoDB + CloudWatch are created/updated

  In parallel, AWS Amplify Hosting is connected directly to the same GitHub repo:
  -> Amplify detects the push (via the GitHub App webhook it installs)
  -> Amplify builds the React frontend (frontend/) using VITE_API_BASE_URL
     from its own Amplify Console environment variables
  -> Amplify publishes the static build to its global CDN
  -> Students open the app from the Amplify app URL
```

Production URL pattern:

```text
Frontend: https://main.YOUR_AMPLIFY_APP_ID.amplifyapp.com
Backend:  https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com
```

---

## 1. Technology stack

### Frontend

- React
- Vite
- JavaScript / JSX
- CSS glassmorphism UI
- AWS Amplify Hosting for static hosting + build CI/CD

### Backend

- AWS Lambda, Node.js 22 runtime
- Amazon API Gateway HTTP API
- Amazon S3 for uploaded study materials
- Amazon DynamoDB for history and progress
- Amazon CloudWatch Logs for Lambda logs
- OpenAI API as the AI brain
- Mock AI mode for classroom demos without OpenAI billing

### DevOps

- GitHub Actions
- Terraform
- AWS CLI
- AWS Amplify Hosting (Git-connected build & deploy)

---

## 2. Final production architecture

```text
Student Browser
  -> https://main.YOUR_AMPLIFY_APP_ID.amplifyapp.com
  -> AWS Amplify Hosting serves React static files (built by Amplify itself)
  -> React calls VITE_API_BASE_URL
  -> API Gateway
  -> Lambda
  -> OpenAI API
  -> S3 for uploaded files
  -> DynamoDB for history/progress
  -> CloudWatch for logs
```

Important: **Amplify only builds and serves the frontend.** It never runs the backend. The backend runs as real AWS Lambda behind API Gateway, deployed separately by GitHub Actions + Terraform. The frontend never sees the OpenAI key or any AWS credentials — it only knows the public API Gateway URL.

---

## 3. Project structure

```text
cloudmentor-serverless-prod/
├── .github/workflows/deploy-prod.yml
├── amplify.yml
├── terraform/
│   ├── versions.tf
│   ├── variables.tf
│   ├── locals.tf
│   ├── lambda.tf
│   ├── apigateway.tf
│   ├── dynamodb.tf
│   ├── s3.tf
│   ├── outputs.tf
│   └── terraform.tfvars.example
├── backend/
│   ├── local-server.mjs
│   ├── package.json
│   ├── env.local.example.json
│   ├── env.production.example.json
│   └── src/
│       ├── app.mjs
│       └── prompts.mjs
├── frontend/
│   ├── .env.example
│   ├── package.json
│   └── src/
├── scripts/
│   └── create-tf-state-backend.sh
└── README.md
```

`amplify.yml` at the repo root tells Amplify this is a monorepo and that the React app lives under `frontend/` — see step 10.

---

## 4. Create an OpenAI API key

1. Go to the OpenAI Platform API key page.
2. Create a new secret key.
3. Save it somewhere safe.
4. For production, put it in GitHub Actions secret `OPENAI_API_KEY` (step 7). Terraform passes it to Lambda as an environment variable — it never touches the frontend or Amplify.

Never commit the API key to GitHub.

Use `AI_MODE=mock` if you want to deploy the app without OpenAI billing while teaching.

---

## 5. One-time: create the Terraform state backend

Terraform needs somewhere durable to store its state between GitHub Actions
runs (the runner itself is thrown away after every job). Run this once per
AWS account/region, from your own machine with the AWS CLI configured:

```bash
AWS_REGION=ap-southeast-1 \
TF_STATE_BUCKET=cloudmentor-tfstate-yourname \
TF_STATE_LOCK_TABLE=cloudmentor-tf-locks \
./scripts/create-tf-state-backend.sh
```

Keep the printed `TF_STATE_BUCKET`, `TF_STATE_KEY`, and `TF_STATE_LOCK_TABLE`
values — they go into GitHub secrets in step 7.

---

## 6. AWS IAM for GitHub Actions

GitHub Actions needs permission to run `terraform apply` for the backend.

For a student/demo project, the easiest option is to create an IAM user with programmatic access and attach enough permissions for:

```text
Lambda
API Gateway (HTTP API / apigatewayv2)
S3 (application bucket + Terraform state bucket)
DynamoDB (application table + Terraform lock table)
CloudWatch Logs
IAM role/policy creation for the Lambda execution role
amplify:StartJob (optional — only needed if you use the optional
  "Trigger Amplify frontend build" workflow step from step 8)
```

For professional production, use GitHub OIDC and an assumable IAM role instead of long-lived access keys.

For classroom simplicity, start with these GitHub secrets:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
```

Note there is no EC2 SSH key or EC2 IAM permission needed anywhere in this
project anymore — the frontend is hosted by Amplify, which builds and
deploys itself once it is connected to the repo (step 10).

---

## 7. GitHub repository secrets

Go to:

```text
GitHub repository
  -> Settings
  -> Secrets and variables
  -> Actions
  -> New repository secret
```

These secrets are used **only** by the GitHub Actions workflow to deploy the
backend with Terraform. None of them are ever needed in Amplify.

Create these secrets:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
STACK_NAME
TF_STATE_BUCKET
TF_STATE_KEY
TF_STATE_LOCK_TABLE
OPENAI_API_KEY
OPENAI_MODEL
AI_MODE
CORS_ORIGIN
```

Optional, only if you want the workflow to force a fresh Amplify build after
a backend-only redeploy (see step 8):

```text
AMPLIFY_APP_ID
AMPLIFY_BRANCH
```

Example values:

```text
AWS_REGION=ap-southeast-1
STACK_NAME=cloudmentor-prod
TF_STATE_BUCKET=cloudmentor-tfstate-yourname
TF_STATE_KEY=cloudmentor/terraform.tfstate
TF_STATE_LOCK_TABLE=cloudmentor-tf-locks
OPENAI_MODEL=gpt-4.1-mini
AI_MODE=openai
CORS_ORIGIN=*
```

`CORS_ORIGIN` is a two-pass value:

1. **First deploy:** you don't have an Amplify URL yet. Either leave `CORS_ORIGIN` unset (the workflow falls back to `*`) or set it to `*` explicitly for a classroom demo.
2. **After step 10**, once your Amplify app has a real URL (e.g. `https://main.d1a2b3c4d5.amplifyapp.com`), come back, update the `CORS_ORIGIN` secret to that exact URL, and re-run the workflow (step 9) so API Gateway and S3 only accept requests from your real frontend.

### Demo deployment without OpenAI billing

Use:

```text
AI_MODE=mock
OPENAI_API_KEY=
```

The workflow can deploy mock mode without a real OpenAI key.

### Real AI deployment

Use:

```text
AI_MODE=openai
OPENAI_API_KEY=sk-proj-your-real-key
```

---

## 8. What GitHub Actions does

The production workflow is here:

```text
.github/workflows/deploy-prod.yml
```

It only deploys the **backend**. When you run it, it performs these steps:

```text
1. Checks out the repository
2. Sets up Node.js 22
3. Configures AWS credentials
4. Installs Terraform
5. Validates required secrets
6. Runs `terraform init` against the remote S3/DynamoDB state backend
7. Runs `terraform apply` to create/update:
   - Lambda (packaged from backend/ via `npm install` + zip)
   - API Gateway HTTP API + routes
   - S3 bucket
   - DynamoDB table
   - IAM role/policies
   - CloudWatch Log Group
8. Reads the API Gateway URL from `terraform output`
9. (Optional) If AMPLIFY_APP_ID is set, triggers a fresh Amplify build via
   `aws amplify start-job`, useful when you redeploy the backend without a
   new commit (e.g. after rotating CORS_ORIGIN)
```

The frontend is built and deployed separately and automatically by AWS
Amplify Hosting itself, once it is connected to this GitHub repo (step 10).
Amplify installs its own GitHub webhook, so an ordinary `git push` to `main`
triggers an Amplify build with no GitHub Actions involvement at all.

---

## 9. Deploy the backend from GitHub Actions

Push the project to GitHub:

```bash
git init
git add .
git commit -m "Initial CloudMentor prod deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Then go to:

```text
GitHub repository -> Actions -> Deploy CloudMentor Production -> Run workflow
```

Watch the workflow logs. When it finishes, note the `api_base_url` printed in
the deployment summary — you'll need it for step 10.

At this point only the backend exists. The frontend is not deployed yet.

---

## 10. Create the AWS Amplify app (frontend hosting)

1. Open the **AWS Amplify** console in the same AWS account/region.
2. Choose **Create new app** (Amplify Hosting) -> **Deploy from Git repository** (Host a web app).
3. Choose **GitHub** as the provider and authorize the Amplify GitHub App if prompted (this replaces the old EC2 SSH key — no personal access token is stored in the app).
4. Select your `CloudMentor-Prod` repository and the `main` branch.
5. Because the React app lives in `frontend/` rather than the repo root, check **"My app is a monorepo"** (or "Connecting a monorepo") and set the app root to:

   ```text
   frontend
   ```

   Amplify will read the `amplify.yml` at the repo root, which already declares `appRoot: frontend`, `npm install`, `npm run build`, and `dist` as the build output.
6. On the build settings / environment variables screen, add one environment variable:

   ```text
   Key:   VITE_API_BASE_URL
   Value: <the api_base_url from step 9, e.g. https://abc123.execute-api.ap-southeast-1.amazonaws.com>
   ```

   This is the **only** value the frontend needs. Vite bakes it into the static JS bundle at build time, so it must be set before you click deploy.
7. Save and deploy. Amplify installs dependencies, runs `npm run build`, and publishes `frontend/dist` to its CDN.
8. Once the build finishes, copy the app's domain from the Amplify console, e.g.:

   ```text
   https://main.d1a2b3c4d5.amplifyapp.com
   ```

   This is your production frontend URL.

---

## 11. Point the backend's CORS at your real Amplify URL

Now that you have a real Amplify domain:

1. Go back to GitHub -> Settings -> Secrets and variables -> Actions.
2. Update the `CORS_ORIGIN` secret to your Amplify domain from step 10, e.g. `https://main.d1a2b3c4d5.amplifyapp.com`.
3. Re-run the GitHub Actions workflow (**Actions -> Deploy CloudMentor Production -> Run workflow**). `terraform apply` updates the API Gateway CORS configuration and the S3 bucket CORS rule to only allow that origin.

For quick classroom demo only, you can leave `CORS_ORIGIN=*`, but that allows any website to call your API.

---

## 12. Backend resources created by Terraform

The `terraform/` directory creates:

### Lambda

```text
<stack_name>-api
Runtime: nodejs22.x
Handler: src/app.handler
```

### API Gateway

Endpoints:

```text
GET  /health
POST /summarize
POST /quiz
POST /flashcards
POST /study-plan
POST /upload-url
POST /process-file
GET  /history
POST /save-progress
```

### S3

Private bucket for uploaded study materials.

S3 is used when students upload files from the frontend. The backend generates a pre-signed URL, the browser uploads the file to S3, and Lambda processes supported text files.

### DynamoDB

Stores AI response history and progress records.

### CloudWatch

The template creates a Lambda log group with 14-day retention:

```text
/aws/lambda/<stack-name>-api
```

Amplify Hosting itself creates no application data resources — only the static build and its own build logs, both visible and manageable from the Amplify console.

---

## 13. Verify production deployment

### Frontend

Open your Amplify domain in a browser:

```text
https://main.YOUR_AMPLIFY_APP_ID.amplifyapp.com
```

The app should load and successfully call the backend (check the browser console/network tab for failed requests, which usually means `VITE_API_BASE_URL` or `CORS_ORIGIN` is wrong — see step 14).

### Backend

Use the API Gateway URL from the GitHub Actions summary or `terraform output api_base_url`:

```bash
curl https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com/health
```

Expected response includes:

```json
{
  "ok": true,
  "service": "CloudMentor API",
  "storageMode": "s3",
  "aiMode": "openai"
}
```

If you deployed with mock mode, `aiMode` will show:

```json
"aiMode": "mock"
```

---

## 14. Common issues

### Frontend still calls localhost

`VITE_API_BASE_URL` was not set (or set incorrectly) as an Amplify Console environment variable before the build ran.

In production, Amplify reads:

```text
VITE_API_BASE_URL=<real API Gateway URL>
```

from its own Console environment variables (App settings -> Environment variables), not from a `.env` file in the repo. Update it there, then redeploy the branch from the Amplify console (Actions menu -> Redeploy this version, or push a new commit).

### CORS error

Set GitHub secret:

```text
CORS_ORIGIN=https://main.YOUR_AMPLIFY_APP_ID.amplifyapp.com
```

Then re-run the GitHub Actions workflow (step 11).

For quick classroom demo only, you can set:

```text
CORS_ORIGIN=*
```

### OpenAI key error

If using real AI:

```text
AI_MODE=openai
OPENAI_API_KEY=sk-proj-your-real-key
```

If using mock mode:

```text
AI_MODE=mock
```

### Amplify build fails

Check the build log in the Amplify console for the failing phase (provision, build, deploy). Common causes:

```text
"My app is a monorepo" was not checked, or the app root was not set to `frontend`
frontend/package.json scripts changed without updating amplify.yml
VITE_API_BASE_URL was missing at build time (frontend still built, but calls the wrong/empty URL)
```

### Terraform apply permission error

The AWS credentials used by GitHub Actions need permission to create/update Lambda, API Gateway (apigatewayv2), S3 (both the app bucket and the Terraform state bucket), DynamoDB (both the app table and the Terraform lock table), IAM roles/policies, and CloudWatch Logs.

### Terraform state lock errors

If a previous workflow run was cancelled mid-apply, the DynamoDB lock table may still hold a stale lock. Check the `TF_STATE_LOCK_TABLE` table in the DynamoDB console and remove the lock item, or run `terraform force-unlock <LOCK_ID>` from the `terraform/` directory with the same backend config.

---

## 15. Delete all AWS resources (avoid ongoing costs)

Do this when you are done teaching/demoing so nothing keeps billing.

1. **Delete the Amplify app** (removes the frontend CDN, build history, and domain):

   ```text
   AWS Amplify console -> select the app -> Actions -> Delete app
   ```

   or with the AWS CLI:

   ```bash
   aws amplify delete-app --app-id YOUR_AMPLIFY_APP_ID --region YOUR_REGION
   ```

2. **Destroy the backend infrastructure** (Lambda, API Gateway, DynamoDB table, S3 materials bucket, IAM role/policies, CloudWatch log group):

   ```bash
   cd terraform
   terraform init \
     -backend-config="bucket=$TF_STATE_BUCKET" \
     -backend-config="key=cloudmentor/terraform.tfstate" \
     -backend-config="region=$AWS_REGION" \
     -backend-config="dynamodb_table=$TF_STATE_LOCK_TABLE"

   terraform destroy \
     -var="aws_region=$AWS_REGION" \
     -var="stack_name=cloudmentor-prod"
   ```

   If the S3 materials bucket has uploaded files in it, `terraform destroy` will fail to delete it until the bucket is empty — empty it first with `aws s3 rm s3://BUCKET_NAME --recursive`, then re-run `terraform destroy`.

3. **Remove the Terraform state backend itself**, if you no longer need it (the state bucket and lock table created by `scripts/create-tf-state-backend.sh` in step 5). Delete these manually last, since Terraform can't destroy the backend it's currently using to store its own state:

   ```bash
   aws s3 rm s3://$TF_STATE_BUCKET --recursive
   aws s3api delete-bucket --bucket $TF_STATE_BUCKET --region $AWS_REGION
   aws dynamodb delete-table --table-name $TF_STATE_LOCK_TABLE --region $AWS_REGION
   ```

4. **Revoke the IAM user's access keys** (or delete the IAM user) that GitHub Actions was using, and remove the corresponding GitHub repository secrets so no stale credentials remain in the repo settings.

5. **Double-check the AWS Billing console / Cost Explorer** a day later to confirm no CloudMentor resources (Lambda, API Gateway, DynamoDB, S3, Amplify, or leftover CloudWatch log groups) are still showing usage.

---

## 16. Teaching explanation

Use this explanation with students:

```text
Frontend and backend are deployed completely differently, and by different systems.

React is compiled into static HTML, CSS, and JavaScript. AWS Amplify Hosting
builds that itself, straight from GitHub, and serves it from its own global
CDN. We never log into a server or manage Nginx by hand.

The backend is not part of Amplify at all. The backend is real serverless
AWS infrastructure. GitHub Actions uses Terraform to create Lambda, API
Gateway, S3, DynamoDB, IAM, and CloudWatch resources.

The frontend does not know the OpenAI key, and it never sees AWS
credentials. It only knows the API Gateway URL, supplied to it once as an
Amplify Console environment variable at build time. Lambda owns the OpenAI
secret and calls OpenAI securely from the backend.
```
