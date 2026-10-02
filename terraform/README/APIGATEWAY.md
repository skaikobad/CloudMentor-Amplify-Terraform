# Understanding `apigateway.tf` — Step by Step

This file creates an **HTTP API Gateway** in front of your Lambda. The API Gateway is the public "front door" that receives HTTP requests from clients and forwards them to your Lambda function.

Let me walk through it section by section.

---

## Section 1: The HTTP API Itself

```hcl
resource "aws_apigatewayv2_api" "cloudmentor_http_api" {
  name          = "${var.stack_name}-http-api"
  protocol_type = "HTTP"
  ...
}
```

- Creates an **API Gateway v2** (the newer, cheaper, faster kind — "HTTP API" not "REST API").
- `protocol_type = "HTTP"` → tells AWS this is an HTTP API (not WebSocket, not REST).
- The name is built from a variable, e.g. `myapp-http-api`.

### CORS configuration

```hcl
cors_configuration {
  allow_origins = [var.cors_origin]
  allow_headers = [ ... ]
  allow_methods = ["GET", "POST", "PUT", "OPTIONS"]
  max_age       = 600
}
```

**CORS** = Cross-Origin Resource Sharing. It's the browser rule that says *"which websites are allowed to call this API?"*

- `allow_origins` → only your frontend URL (e.g. `https://myapp.com`) may call this API.
- `allow_headers` → which request headers are allowed. Includes `Content-Type`, `Authorization`, and some AWS signing headers (`x-amz-*`).
- `allow_methods` → which HTTP verbs are allowed: GET, POST, PUT, OPTIONS.
  - `OPTIONS` is required — browsers send a preflight OPTIONS request before real requests.
- `max_age = 600` → browsers can cache the CORS preflight result for **600 seconds** (10 min), reducing extra requests.

**Analogy:** This is like a bouncer at a club who has a guest list — only requests from your frontend domain are let in.

---

## Section 2: The Default Stage

```hcl
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.cloudmentor_http_api.id
  name        = "$default"
  auto_deploy = true
}
```

- In API Gateway, a **stage** is a named deployment environment (like `dev`, `prod`, `v1`).
- `name = "$default"` → the special default stage.
- With `$default`, your URL is short: `https://abc123.execute-api.us-east-1.amazonaws.com/` (no `/dev/` prefix).
- `auto_deploy = true` → whenever routes or integrations change, redeploy automatically. No manual "deploy" step needed.

---

## Section 3: The Lambda Integration

```hcl
resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.cloudmentor_http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.cloudmentor_api.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}
```

This tells API Gateway **how to talk to the Lambda**.

- `integration_type = "AWS_PROXY"` → **proxy integration** means: pass the entire HTTP request straight through to Lambda as-is (headers, body, query, path). Let the Lambda decide everything. This is the most flexible mode.
  - The alternative would be "mapping" every field manually, which is tedious.
- `integration_uri` → the Lambda's invoke ARN (the address API Gateway calls).
- `integration_method = "POST"` → **always** invokes Lambda with POST internally, even if the client sent a GET. Lambda still sees the real method in the event payload.
- `payload_format_version = "2.0"` → uses the newer, cleaner event format for Lambda (v2 has nicer shapes for headers, cookies, etc.).

**Key idea from the comment:** one single integration serves *every* route. Same pattern SAM used — one Lambda handles all paths.

---

## Section 4: The Routes

```hcl
resource "aws_apigatewayv2_route" "routes" {
  for_each  = local.routes
  api_id    = aws_apigatewayv2_api.cloudmentor_http_api.id
  route_key = "${each.value.method} ${each.value.path}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}
```

This defines **which URLs (routes) map to which integration**.

- `for_each = local.routes` → loops over a variable called `local.routes`, which is defined elsewhere (probably in `locals` or `variables`). That local is a map like:

  ```hcl
  routes = {
    get_materials   = { method = "GET",  path = "/materials" }
    post_question   = { method = "POST", path = "/question" }
    ...
  }
  ```

- `route_key` → a string combining method + path, e.g. `"GET /materials"`. That's how API Gateway identifies a route.
- `target` → sends all matched routes to the same Lambda integration. This is why one Lambda can handle everything.

**Analogy:** Think of it as a phonebook. Each entry says "if someone calls this exact number (method + path), forward them to this person (the Lambda)."

Because it's a proxy integration, the Lambda receives the full original request and figures out what to do (using its own router, like in Express or Fastify).

---

## Section 5: Permission for API Gateway to Invoke Lambda

```hcl
resource "aws_lambda_permission" "apigw_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cloudmentor_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.cloudmentor_http_api.execution_arn}/*/*"
}
```

**Why is this needed?** By default, AWS blocks *everyone* from invoking your Lambda. Even API Gateway. You have to explicitly say "yes, API Gateway may call this Lambda."

- `action = "lambda:InvokeFunction"` → the permission being granted.
- `principal = "apigateway.amazonaws.com"` → **who** gets permission (the API Gateway service).
- `function_name` → **which** Lambda.
- `source_arn` → **which** API Gateway can invoke it.
  - `"${...execution_arn}/*/*"` = wildcard for "*any stage, any route*" of this specific API. So only *your* API Gateway can trigger *your* Lambda — not someone else's.
  - The two `*`s mean: `/{stage}/{route}` → any stage, any method/path.

**Analogy:** It's like giving a doorman permission to let guests into your house — but only *your* doorman, and only for *your* house.

---

## Big Picture Flow

```
Client (browser)
      │
      ▼
┌─────────────────────────────────────────┐
│  API Gateway (HTTP API)                 │
│  - CORS check                           │
│  - Match route (method + path)          │
│  - Forward to Lambda integration        │
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│  Lambda (aws_lambda_function)           │
│  - Receives full HTTP event (v2 format) │
│  - Runs your Node.js handler            │
│  - Returns a response                   │
└─────────────────────────────────────────┘
```

---

## Mapping to SAM (from the comments)

If you came from AWS SAM, here's the translation:

| SAM (in `template.yaml`)          | Terraform equivalent (this file)         |
|-----------------------------------|------------------------------------------|
| `AWS::Serverless::HttpApi`        | `aws_apigatewayv2_api` + `_stage`        |
| `Events: HttpApi: path/method`    | `aws_apigatewayv2_route`                 |
| Implicit Lambda integration       | `aws_apigatewayv2_integration`           |
| Implicit invoke permission        | `aws_lambda_permission`                  |
| Auto CORS config                  | `cors_configuration` block               |

SAM hides all of this behind a few lines. Terraform makes you write each piece explicitly — that's the trade-off for more control and predictability.

---

## TL;DR

1. **Create the API** (`aws_apigatewayv2_api`) with CORS.
2. **Create the stage** (`$default`) so it's live at a URL.
3. **Wire the Lambda** via a proxy integration.
4. **Define routes** (from `local.routes`) that all hit that one Lambda.
5. **Grant Lambda invoke permission** to API Gateway — scoped to your API only.

That's the whole story of `apigateway.tf`. 🎯