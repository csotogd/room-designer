resource "google_service_account" "frontend" {
  account_id   = "room-designer-${var.environment}-web"
  display_name = "Editor web sin permisos sobre los datos"
}

resource "google_cloud_run_v2_service" "frontend" {
  name                = "${local.prefix}-frontend"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.environment == "prod"

  template {
    service_account                  = var.chat_enabled ? google_service_account.designer[0].email : google_service_account.frontend.email
    timeout                          = "3600s"
    max_instance_request_concurrency = 20
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      name       = "frontend"
      image      = var.web_image
      depends_on = var.chat_enabled ? ["designer", "search"] : []
      ports { container_port = 8080 }
      resources {
        limits   = { cpu = "1", memory = "256Mi" }
        cpu_idle = true
      }
      startup_probe {
        http_get { path = "/healthz" }
      }
      dynamic "volume_mounts" {
        for_each = var.chat_enabled ? [1] : []
        content {
          name       = "catalog"
          mount_path = "/cloud"
        }
      }
    }
    dynamic "containers" {
      for_each = var.chat_enabled ? { designer = 8790, search = 8787 } : {}
      content {
        name    = containers.key
        image   = var.backend_image
        command = ["${containers.key}-serve"]
        resources {
          limits   = { cpu = "1", memory = "1Gi" }
          cpu_idle = true
        }
        startup_probe {
          initial_delay_seconds = 0
          period_seconds        = 5
          failure_threshold     = 24
          http_get {
            path = "/healthz"
            port = containers.value
          }
        }
        volume_mounts {
          name       = "catalog"
          mount_path = "/app/public"
        }
        dynamic "env" {
          for_each = merge({
            PORT               = tostring(containers.value)
            CATALOG_SITE       = "polyhaven"
            CATALOG_PUBLIC_DIR = "/app/public"
            }, containers.key == "designer" ? {
            DESIGNER_PROVIDER        = "gemini"
            DESIGNER_ALLOWED_ORIGINS = join(",", var.designer_allowed_origins)
            DESIGNER_MODEL           = var.designer_model
            DESIGNER_STATE_PROJECT   = var.project_id
            DESIGNER_STATE_BUCKET    = google_storage_bucket.assets.name
            DESIGNER_ROOM_ID         = "shared"
            SCREENSHOT_BUCKET        = google_storage_bucket.assets.name
            SEARCH_URL               = "http://127.0.0.1:8787"
            RATE_LIMIT_PER_MINUTE    = "30"
            } : {
            EMBEDDINGS_PROVIDER = "hashing"
            SEARCH_DATA_DIR     = "/data/search"
          })
          content {
            name  = env.key
            value = env.value
          }
        }
        dynamic "env" {
          for_each = containers.key == "designer" ? [1] : []
          content {
            name = "GOOGLE_API_KEY"
            value_source {
              secret_key_ref {
                secret  = data.google_secret_manager_secret.gemini[0].secret_id
                version = var.gemini_secret_version
              }
            }
          }
        }
      }
    }
    dynamic "volumes" {
      for_each = var.chat_enabled ? [1] : []
      content {
        name = "catalog"
        gcs {
          bucket    = google_storage_bucket.assets.name
          read_only = true
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition     = !var.chat_enabled || var.backend_image != null
      error_message = "El chat necesita una imagen Python probada."
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.designer_gemini,
    google_storage_bucket_iam_member.designer_catalog,
  google_storage_bucket_iam_member.designer_snapshots, google_project_iam_member.designer_firestore]
}

resource "google_cloud_run_v2_service_iam_member" "deploy_checks_frontend" {
  name     = google_cloud_run_v2_service.frontend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:rd-${var.environment}-deploy@${var.project_id}.iam.gserviceaccount.com"
}
