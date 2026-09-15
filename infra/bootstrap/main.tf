terraform {
  required_version = ">= 1.7"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
  backend "local" {}
}

provider "google" {
  project = var.project_id
  region  = "europe-west1"
}

variable "project_id" {
  type = string
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "stage", "prod"], var.environment)
    error_message = "Usar dev, stage o prod."
  }
}

variable "enable_airflow" {
  description = "Habilitar permisos de Airflow solo en el entorno que se vaya a operar"
  type        = bool
  default     = false
}

locals {
  apis = toset(concat([
    "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com", "serviceusage.googleapis.com",
    "run.googleapis.com", "cloudscheduler.googleapis.com", "pubsub.googleapis.com",
    "firestore.googleapis.com", "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com", "storage.googleapis.com", "cloudbuild.googleapis.com",
    ], var.enable_airflow ? [
    "compute.googleapis.com", "iap.googleapis.com", "monitoring.googleapis.com", "logging.googleapis.com",
  ] : []))
  # Terraform administra IAM además de recursos. Esta identidad es de confianza:
  # no se entrega a PR y sus ramas deben quedar protegidas antes de activar WIF.
  deploy_roles = toset(concat([
    "roles/run.admin", "roles/storage.admin", "roles/datastore.owner",
    "roles/pubsub.admin", "roles/cloudscheduler.admin", "roles/secretmanager.admin",
    "roles/iam.serviceAccountAdmin", "roles/iam.serviceAccountUser",
    "roles/resourcemanager.projectIamAdmin", "roles/serviceusage.serviceUsageConsumer",
    "roles/cloudbuild.builds.editor",
    ], var.enable_airflow ? [
    "roles/compute.instanceAdmin.v1", "roles/compute.networkAdmin", "roles/compute.securityAdmin",
    "roles/compute.storageAdmin", "roles/compute.osAdminLogin", "roles/iap.tunnelResourceAccessor",
    "roles/monitoring.editor", "roles/logging.configWriter",
  ] : []))
}

resource "google_project_service" "apis" {
  for_each           = local.apis
  service            = each.value
  disable_on_destroy = false
}

resource "google_storage_bucket" "state" {
  name                        = "${var.project_id}-tfstate"
  location                    = "europe-west1"
  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning { enabled = true }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.apis]
}

resource "google_artifact_registry_repository" "pipeline" {
  location      = "europe-west1"
  repository_id = "room-designer-${var.environment}-pipeline"
  format        = "DOCKER"
  docker_config { immutable_tags = true }
  depends_on = [google_project_service.apis]
}

resource "google_service_account" "deploy" {
  account_id   = "rd-${var.environment}-deploy"
  display_name = "Entrega del entorno ${var.environment} desde GitHub"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "deploy" {
  for_each = local.deploy_roles
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_artifact_registry_repository_iam_member" "deploy_reads_images" {
  location   = google_artifact_registry_repository.pipeline.location
  repository = google_artifact_registry_repository.pipeline.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_service_account" "build" {
  account_id   = "rd-${var.environment}-build"
  display_name = "Cloud Build ${var.environment}, sin permisos de despliegue"
  depends_on   = [google_project_service.apis]
}

resource "google_artifact_registry_repository_iam_member" "build_publishes" {
  location   = google_artifact_registry_repository.pipeline.location
  repository = google_artifact_registry_repository.pipeline.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.build.email}"
}

resource "google_project_iam_member" "build_writes_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.build.email}"
}

resource "google_storage_bucket" "build_source" {
  name                        = "${var.project_id}-build-source"
  location                    = "europe-west1"
  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 7 }
  }
  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "build_reads_source" {
  bucket = google_storage_bucket.build_source.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.build.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-${var.environment}"
  display_name              = "GitHub ${var.environment}"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "room-designer"
  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
    "attribute.environment"         = "assertion.environment"
    "attribute.event_name"          = "assertion.event_name"
    "attribute.workflow_ref"        = "assertion.workflow_ref"
  }
  attribute_condition = join(" && ", [
    "assertion.repository_id == '1355247115'",
    "assertion.repository_owner_id == '55759561'",
    "assertion.ref == 'refs/heads/${var.environment}'",
    "assertion.environment == '${var.environment}'",
    "assertion.event_name == 'push'",
    "assertion.workflow_ref == 'csotogd/room-designer/.github/workflows/ci.yml@refs/heads/${var.environment}'",
  ])
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}

resource "google_service_account_iam_member" "github_deploys" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/1355247115"
}

# Solo puede emitir el token de su propia identidad para el smoke privado.
resource "google_service_account_iam_member" "smoke_token" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.serviceAccountOpenIdTokenCreator"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}

output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "state_bucket" {
  value = google_storage_bucket.state.name
}
