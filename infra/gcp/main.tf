terraform {
  required_version = ">= 1.7"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
  # backend "gcs" { bucket = "<tfstate-bucket>" prefix = "room-designer" }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  prefix = "room-designer-${var.environment}"
  apis = [
    "run.googleapis.com",
    "cloudscheduler.googleapis.com",
    "pubsub.googleapis.com",
    "firestore.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "aiplatform.googleapis.com", # juez VLM vía Vertex si judge_provider=vertex
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# ── Registro de imágenes del pipeline ──────────────────────────────────────

resource "google_artifact_registry_repository" "pipeline" {
  location      = var.region
  repository_id = "${local.prefix}-pipeline"
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}
