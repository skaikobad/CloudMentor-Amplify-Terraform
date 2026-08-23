# Teaching Plan — CloudMentor

## Session 1 — Product and Architecture

Explain the app problem:

> Students have notes or study files but need summaries, quizzes, flashcards, and study plans.

Draw this architecture:

```text
Browser → API Gateway → Lambda → OpenAI
              ↓           ↓
          S3 upload    DynamoDB
```

Key concepts:

- Frontend should never hold private AI API keys.
- Lambda is the secure bridge between frontend and AI provider.
- S3 stores uploaded study materials.
- DynamoDB keeps history and progress.
- Local dev mode (`npm run dev`, backed by `local-server.mjs`) can mimic S3 and DynamoDB with temporary local storage.

## Session 2 — Frontend

Tasks:

- Run Vite React app locally.
- Explain components and state.
- Show how the frontend calls `VITE_API_BASE_URL`.
- Demonstrate loading states and error handling.
- Upload a `.txt` or `.md` file and load its text into the notes box.

Student challenge:

- Add a new button named `Explain Like I Am 10`.

## Session 3 — Lambda Backend

Tasks:

- Explain the API routes.
- Explain Lambda proxy events.
- Explain `fetch()` call to OpenAI.
- Explain why prompt templates are separated.
- Explain local upload mode versus S3 upload mode.

Student challenge:

- Add a route `/concept-map`.

## Session 4 — S3 Upload Flow

Tasks:

- Explain why browsers should not directly receive AWS credentials.
- Explain S3 pre-signed URLs.
- Walk through:

```text
React → POST /upload-url → Lambda creates pre-signed URL
React → PUT file directly to S3
React → POST /process-file → Lambda reads S3 object and extracts text
```

Student challenge:

- Show the uploaded object in the S3 console.
- Add a file size warning before upload.

## Session 5 — Terraform Deployment

Tasks:

- Explain the `terraform/` directory (`lambda.tf`, `apigateway.tf`, `dynamodb.tf`, `s3.tf`).
- Explain IAM roles/policies for DynamoDB and S3 (Terraform has no shorthand like SAM's `Policies:`, so they're written out explicitly).
- Explain why Terraform state needs a remote backend (S3 + DynamoDB lock table) for CI/CD.
- Run `terraform init` and `terraform plan` to preview changes.
- Run `terraform apply` to deploy.
- Test API with curl.

Student challenge:

- Change `memory_size` and `timeout` in `lambda.tf`, run `terraform plan`, then apply.

## Session 6 — DynamoDB and Observability

Tasks:

- Open DynamoDB table.
- Open the S3 bucket.
- Open CloudWatch logs.
- Trigger an error and debug it from logs.

Student challenge:

- Save quiz scores into DynamoDB and display them in the UI.

## Session 7 — Production Readiness

Discuss:

- Cognito authentication
- Per-user S3 prefixes
- Secrets Manager
- CORS restriction
- CloudFront hosting
- File validation and virus scanning
- Cost controls
- Monitoring and alarms
- CI/CD pipeline
