mock_provider "google" {}

variables {
  project_id  = "designer-test-123"
  environment = "dev"
  web_image   = "europe-west1-docker.pkg.dev/designer-test-123/room-designer-dev-pipeline/frontend@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

run "safe_dev_foundation" {
  command = plan
  assert {
    condition     = google_storage_bucket.assets.force_destroy == false && google_storage_bucket.assets.public_access_prevention == "enforced"
    error_message = "Los datos no pueden ser públicos ni borrarse recursivamente."
  }
  assert {
    condition     = google_cloud_run_v2_service.frontend.name == "room-designer-dev-frontend" && google_cloud_run_v2_service.frontend.template[0].scaling[0].max_instance_count == 1
    error_message = "El editor debe usar el entorno correcto con escala acotada."
  }
  assert {
    condition     = length(google_cloud_run_v2_service.generator) == 0 && length(google_cloud_run_v2_job.ingest) == 0 && length(google_cloud_scheduler_job.ingest) == 0
    error_message = "Los adaptadores de catálogo incompletos no pueden arrancar ni generar consumo."
  }
}

run "stage_is_separate" {
  command = plan
  variables {
    environment = "stage"
    project_id  = "designer-stage-123"
    web_image   = "europe-west1-docker.pkg.dev/designer-stage-123/room-designer-stage-pipeline/frontend@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  assert {
    condition     = google_storage_bucket.assets.name == "designer-stage-123-room-designer-stage-assets" && google_service_account.generator.account_id == "room-designer-stage-generator"
    error_message = "Stage debe tener datos e identidades propios."
  }
}

run "prod_is_separate" {
  command = plan
  variables {
    environment = "prod"
    project_id  = "designer-prod-123"
    web_image   = "europe-west1-docker.pkg.dev/designer-prod-123/room-designer-prod-pipeline/frontend@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  assert {
    condition     = google_storage_bucket.assets.name == "designer-prod-123-room-designer-prod-assets" && google_cloud_run_v2_service.frontend.deletion_protection == true
    error_message = "Producción necesita recursos propios y protección contra borrados."
  }
}

run "reject_staging_typo" {
  command = plan
  variables { environment = "staging" }
  expect_failures = [var.environment]
}

run "reject_mutable_image" {
  command = plan
  variables { web_image = "example.com/frontend:latest" }
  expect_failures = [var.web_image]
}

run "reject_unimplemented_catalog_runtime" {
  command = plan
  variables { enable_catalog_runtime = true }
  expect_failures = [var.enable_catalog_runtime]
}
