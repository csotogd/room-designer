# ── Identidades ────────────────────────────────────────────────────────────

resource "google_service_account" "ingest" {
  account_id   = "${local.prefix}-ingest"
  display_name = "Room Designer · ingesta de catálogos"
}

resource "google_service_account" "generator" {
  account_id   = "${local.prefix}-generator"
  display_name = "Room Designer · generación 3D y juez"
}

resource "google_service_account" "scheduler" {
  account_id   = "${local.prefix}-scheduler"
  display_name = "Room Designer · disparo programado"
}

# ── Secretos (claves de APIs externas) ─────────────────────────────────────

resource "google_secret_manager_secret" "tripo_api_key" {
  secret_id = "${local.prefix}-tripo-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "judge_api_key" {
  secret_id = "${local.prefix}-judge-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "generator_reads_tripo" {
  secret_id = google_secret_manager_secret.tripo_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.generator.email}"
}

resource "google_secret_manager_secret_iam_member" "generator_reads_judge" {
  secret_id = google_secret_manager_secret.judge_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.generator.email}"
}

resource "google_secret_manager_secret_iam_member" "ingest_reads_judge" {
  secret_id = google_secret_manager_secret.judge_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingest.email}"
}

# ── Cola entre ingesta y generación ────────────────────────────────────────

resource "google_pubsub_topic" "products_to_generate" {
  name = "${local.prefix}-products-to-generate"
}

resource "google_pubsub_topic" "products_dead_letter" {
  name = "${local.prefix}-products-dlq"
}

resource "google_pubsub_subscription" "generator_push" {
  name  = "${local.prefix}-generator-push"
  topic = google_pubsub_topic.products_to_generate.id

  ack_deadline_seconds = 600 # una generación tarda 1-2 min; margen amplio

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.generator.uri}/generate"
    oidc_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  retry_policy {
    minimum_backoff = "60s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.products_dead_letter.id
    max_delivery_attempts = 5
  }
}

resource "google_pubsub_topic_iam_member" "ingest_publishes" {
  topic  = google_pubsub_topic.products_to_generate.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.ingest.email}"
}

# ── Job de ingesta (scraper + selección de imagen) ─────────────────────────
# Contenedor del pipeline (pipeline/cli/ingest.ts en modo cloud): scrapea el
# sitio, elige el packshot (VLM juez de imagen si está activado; si no,
# heurística), sube assets a GCS y publica cada producto pendiente en Pub/Sub.

resource "google_cloud_run_v2_job" "ingest" {
  name     = "${local.prefix}-ingest"
  location = var.region

  template {
    template {
      service_account = google_service_account.ingest.email
      max_retries     = 1
      timeout         = "1800s"

      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.pipeline.repository_id}/pipeline:${var.pipeline_image_tag}"
        args  = ["ingest"] # el site/country/limit llegan por overrides del scheduler

        env {
          name  = "ASSETS_BUCKET"
          value = google_storage_bucket.assets.name
        }
        env {
          name  = "PUBSUB_TOPIC"
          value = google_pubsub_topic.products_to_generate.id
        }
        env {
          name  = "VLM_IMAGE_SELECTION"
          value = var.vlm_image_selection_enabled ? "on" : "off"
        }
        env {
          # Recorte/síntesis de imagen con VLM cuando no hay packshot.
          # Decisión de producto: APAGADO por ahora.
          name  = "VLM_IMAGE_DECODE"
          value = var.vlm_image_decode_enabled ? "on" : "off"
        }
        env {
          name  = "JUDGE_PROVIDER"
          value = var.judge_provider
        }
        env {
          name  = "JUDGE_MODEL"
          value = var.judge_model
        }
        env {
          name = "JUDGE_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.judge_api_key.secret_id
              version = "latest"
            }
          }
        }
        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }
      }
    }
  }
}

# ── Servicio generador (reconstrucción 3D + juez + catálogo) ───────────────
# Recibe cada producto por push de Pub/Sub, llama a la API de generación,
# guarda GLB y preview en GCS, pasa el juez VLM y escribe el documento en la
# colección catalog_{site}_{country} de Firestore.

resource "google_cloud_run_v2_service" "generator" {
  name     = "${local.prefix}-generator"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account                  = google_service_account.generator.email
    max_instance_request_concurrency = 4
    timeout                          = "600s"

    scaling {
      min_instance_count = 0
      max_instance_count = 8 # paraleliza catálogos grandes; sube según cuota del proveedor
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.pipeline.repository_id}/pipeline:${var.pipeline_image_tag}"
      args  = ["serve-generator"]

      env {
        name  = "ASSETS_BUCKET"
        value = google_storage_bucket.assets.name
      }
      env {
        name  = "GENERATOR"
        value = var.generator_provider
      }
      env {
        name  = "JUDGE_PROVIDER"
        value = var.judge_provider
      }
      env {
        name  = "JUDGE_MODEL"
        value = var.judge_model
      }
      env {
        name = "TRIPO_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.tripo_api_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "JUDGE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.judge_api_key.secret_id
            version = "latest"
          }
        }
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "pubsub_invokes_generator" {
  name     = google_cloud_run_v2_service.generator.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# ── Permisos sobre datos ───────────────────────────────────────────────────

resource "google_storage_bucket_iam_member" "ingest_writes_assets" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ingest.email}"
}

resource "google_storage_bucket_iam_member" "generator_writes_assets" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.generator.email}"
}

resource "google_project_iam_member" "ingest_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.ingest.email}"
}

resource "google_project_iam_member" "generator_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.generator.email}"
}

# ── Disparo programado: una ingesta por fuente (sitio × país) ──────────────

resource "google_cloud_scheduler_job" "ingest" {
  for_each = { for s in var.catalog_sources : "${s.site}-${s.country}" => s }

  name      = "${local.prefix}-ingest-${each.key}"
  region    = var.region
  schedule  = each.value.schedule
  time_zone = "Europe/Madrid"

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.ingest.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }

    # Parámetros de la ejecución: sitio, país y límite.
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{
          args = [
            "ingest",
            "--site", each.value.site,
            "--country", each.value.country,
            "--limit", tostring(each.value.limit),
          ]
        }]
      }
    }))
    headers = { "Content-Type" = "application/json" }
  }
}

resource "google_project_iam_member" "scheduler_runs_jobs" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.scheduler.email}"
}
