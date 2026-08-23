locals {
  function_name = "${var.stack_name}-api"

  # Mirrors the `Events:` block from the old backend/template.yaml SAM template.
  routes = {
    Health       = { method = "GET", path = "/health" }
    UploadUrl    = { method = "POST", path = "/upload-url" }
    ProcessFile  = { method = "POST", path = "/process-file" }
    LocalUpload  = { method = "PUT", path = "/local-upload/{proxy+}" }
    Summarize    = { method = "POST", path = "/summarize" }
    Quiz         = { method = "POST", path = "/quiz" }
    Flashcards   = { method = "POST", path = "/flashcards" }
    StudyPlan    = { method = "POST", path = "/study-plan" }
    History      = { method = "GET", path = "/history" }
    Progress     = { method = "POST", path = "/save-progress" }
  }
}
