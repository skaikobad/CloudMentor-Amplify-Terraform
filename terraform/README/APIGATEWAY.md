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
  - `GET` = read data.
  - `POST` = create data.
  - `PUT` = update data.
  - `OPTIONS` is required — Browsers automatically send an OPTIONS request (preflight request) before any real requests.
- `max_age = 600` → How long can the browser cache the CORS permission? **600 seconds** (10 min), reducing extra requests. After the browser gets a successful preflight response, it remembers the rules for 10 minutes and skips the OPTIONS check on subsequent calls.

**Quick Analogy:** 
  - `allow_origins` = "Who can come to my house?"
  - `allow_headers` = "What can you bring with you?"
  - `allow_methods` = "What can you do when you get here?"
  - `max_age` = "How long can you stay?"

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
- `name = "$default"` → is a special built-in stage in API Gateway v2.
- **Its superpower: it removes the stage name from the URL.**
- Named stage `prod` → `https://abc123.execute-api.us-east-1.amazonaws.com/prod/users`.
- Default stage → `https://abc123.execute-api.us-east-1.amazonaws.com/users`. (No /`prod`/ or `/dev/` prefix)
- This makes your API URLs cleaner and lets you use a custom domain (e.g., `api.myapp.com/users`) without mapping a stage path.
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

**Why is this needed?** 
By default, Lambda functions can't be invoked by other AWS services unless you explicitly grant them permission. This resource creates a resource-based policy on your Lambda that says: "API Gateway is allowed to call me."

Without this, API Gateway would hit your Lambda and get `AccessDeniedException` — your routes would return 500 errors.

- `statement_id = "AllowAPIGatewayInvoke"` → A human-readable label for the policy statement. Must be unique per Lambda function — if you add another permission for the same function, use a different `statement_id`.
- `action = "lambda:InvokeFunction"` → The permission being granted. It does not grant `UpdateFunctionCode`, `DeleteFunction`, or any other power — just invoke.
- `function_name` → **which** Lambda. This is required — it's how AWS knows which Lambda to grant permission to.
- `principal = "apigateway.amazonaws.com"` → **who** gets permission (the API Gateway service). This is required — it's how AWS knows the service (not a specific user/role) is calling.
- **⚠️ Important:**: This alone would let any API Gateway in any AWS account invoke your Lambda — which is why source_arn exists. 👇
- `source_arn` → **which** API Gateway can invoke it. Only allow calls from this specific API.
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

## TL;DR

1. `aws_apigatewayv2_api`           → defines the API + CORS
2. `aws_apigatewayv2_stage`         → makes it reachable on `$default` URL
3. `aws_lambda_permission`          → lets API Gateway actually call the Lambda
4. `aws_apigatewayv2_integration`   → (next) wires a route to the Lambda
5. `aws_apigatewayv2_route`         → (next) maps HTTP method+path → integration

*Together, these five resources form the full "browser → API Gateway → Lambda" path.*

That's the whole story of `apigateway.tf`. 🎯