# Understanding `locals.tf` — Step by Step

This file defines **local values** in Terraform. Locals are like variables you create *inside* your Terraform code to avoid repeating yourself. They're not inputs (like `var.*`) and not outputs — they're just named values you can reuse.

---

## Step 1: What is a `locals` block?

```hcl
locals {
  ...
}
```

- `locals` is a Terraform block that holds **computed or reusable values**.
- You refer to them later using `local.<name>` (note: singular `local`, not `locals`).
- They help keep your config DRY (Don't Repeat Yourself).

---

## Step 2: The first local — `function_name`

```hcl
function_name = "${var.stack_name}-api"
```

- It builds a string by taking a variable called `stack_name` (e.g. `"myapp-dev"`) and appending `-api`.
- Result example: `"myapp-dev-api"`.
- This is likely the name of a **Lambda function** or API service used elsewhere in the Terraform config.
- Using a local here means if you change the naming pattern, you only change it in one place.

---

## Step 3: The comment

```hcl
# Mirrors the `Events:` block from the old backend/template.yaml SAM template.
```

- This tells the reader: *"We used to define these routes in AWS SAM's `template.yaml` under an `Events:` section. Now we're defining them in Terraform instead."*
- It's a migration note — helpful context for anyone comparing old vs. new code.

---

## Step 4: The `routes` map

```hcl
routes = {
  Health       = { method = "GET",  path = "/health" }
  UploadUrl    = { method = "POST", path = "/upload-url" }
  ProcessFile  = { method = "POST", path = "/process-file" }
  LocalUpload  = { method = "PUT",  path = "/local-upload/{proxy+}" }
  Summarize    = { method = "POST", path = "/summarize" }
  Quiz         = { method = "POST", path = "/quiz" }
  Flashcards   = { method = "POST", path = "/flashcards" }
  StudyPlan    = { method = "POST", path = "/study-plan" }
  History      = { method = "GET",  path = "/history" }
  Progress     = { method = "POST", path = "/save-progress" }
}
```

### What is this?
A **map** (dictionary) where:
- The **key** (e.g. `Health`, `UploadUrl`) is a logical name for the route.
- The **value** is another small map with two fields:
  - `method` → HTTP verb (`GET`, `POST`, `PUT`)
  - `path` → the URL path (e.g. `/health`)

### Why use a map?
Later in your Terraform code, you can **loop over** this map to create API Gateway routes automatically. Something like:

```hcl
resource "aws_apigatewayv2_route" "this" {
  for_each  = local.routes
  route_key = "${each.value.method} ${each.value.path}"
  # ...
}
```

That single loop creates **10 routes** without writing 10 separate resource blocks.

---

## Step 5: Route-by-route meaning

| Key          | Method | Path                        | Purpose (inferred)                         |
| ------------ | ------ | --------------------------- | ------------------------------------------ |
| `Health`     | GET    | `/health`                   | Health check / uptime probe                |
| `UploadUrl`  | POST   | `/upload-url`               | Get a presigned S3 upload URL              |
| `ProcessFile`| POST   | `/process-file`             | Trigger processing of a file               |
| `LocalUpload`| PUT    | `/local-upload/{proxy+}`    | Upload to local dev storage; catch-all subpath |
| `Summarize`  | POST   | `/summarize`                | AI summarize a document                    |
| `Quiz`       | POST   | `/quiz`                     | Generate a quiz                            |
| `Flashcards` | POST   | `/flashcards`               | Generate flashcards                        |
| `StudyPlan`  | POST   | `/study-plan`               | Generate a study plan                      |
| `History`    | GET    | `/history`                  | Fetch user's history                       |
| `Progress`   | POST   | `/save-progress`            | Save study progress                        |

The `{proxy+}` in `LocalUpload` is **API Gateway syntax** meaning "match any sub-path", so `/local-upload/a/b/c.txt` also routes here.

---

## Step 6: Big picture

This file is a **single source of truth** for:

1. The API/Lambda **name**.
2. The **list of HTTP routes** the API exposes.

Anywhere else in your Terraform (API Gateway, Lambda permissions, IAM, etc.) you can reference `local.function_name` or `local.routes` instead of hardcoding values. That makes the config:

- Easier to read
- Easier to change
- Less error-prone

---

## TL;DR

- `locals` = reusable named values in Terraform.
- `function_name` = builds `"<stack_name>-api"`.
- `routes` = a map of 10 HTTP endpoints (method + path), used to auto-generate API Gateway routes.
- The comment notes this replaces the old SAM template's `Events:` section.