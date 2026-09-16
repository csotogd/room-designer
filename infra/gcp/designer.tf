resource "google_service_account" "designer" {
  count        = var.chat_enabled ? 1 : 0
  account_id   = "${local.prefix}-designer"
  display_name = "Chat Python con acceso privado al estado y al catálogo"
}

# El valor se carga fuera de Terraform para que nunca termine en el estado ni en Git.
data "google_secret_manager_secret" "gemini" {
  count     = var.chat_enabled ? 1 : 0
  secret_id = "${local.prefix}-gemini-api-key"
}

resource "google_secret_manager_secret_iam_member" "designer_gemini" {
  count     = var.chat_enabled ? 1 : 0
  secret_id = data.google_secret_manager_secret.gemini[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.designer[0].email}"
}

resource "google_storage_bucket_iam_member" "designer_catalog" {
  count  = var.chat_enabled ? 1 : 0
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.designer[0].email}"
}

resource "google_storage_bucket_iam_member" "designer_snapshots" {
  count  = var.chat_enabled ? 1 : 0
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.designer[0].email}"
  condition {
    title      = "solo_estado_y_capturas"
    expression = "resource.name.startsWith('projects/_/buckets/${google_storage_bucket.assets.name}/objects/designer/')"
  }
}

resource "google_project_iam_member" "designer_firestore" {
  count   = var.chat_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.designer[0].email}"
}
