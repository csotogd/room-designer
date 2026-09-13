terraform {
  required_version = ">= 1.7"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  prefix = "room-designer-${var.environment}"
}

# ── Registro de imágenes del pipeline ──────────────────────────────────────

data "google_artifact_registry_repository" "pipeline" {
  location      = var.region
  repository_id = "${local.prefix}-pipeline"
}
