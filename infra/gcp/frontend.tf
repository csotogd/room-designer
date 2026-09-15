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
    service_account = google_service_account.frontend.email
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      image = var.web_image
      ports { container_port = 8080 }
      resources {
        limits   = { cpu = "1", memory = "256Mi" }
        cpu_idle = true
      }
      startup_probe {
        http_get { path = "/healthz" }
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "deploy_checks_frontend" {
  name     = google_cloud_run_v2_service.frontend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:rd-${var.environment}-deploy@${var.project_id}.iam.gserviceaccount.com"
}
