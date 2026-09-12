mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      name  = "projects/designer-dev-123/serviceAccounts/rd-dev-deploy@designer-dev-123.iam.gserviceaccount.com"
      email = "rd-dev-deploy@designer-dev-123.iam.gserviceaccount.com"
    }
  }
}

variables {
  project_id  = "designer-dev-123"
  environment = "dev"
}

run "identity_and_state_are_scoped" {
  command = plan
  assert {
    condition     = google_service_account.deploy.account_id == "rd-dev-deploy" && google_storage_bucket.state.name == "designer-dev-123-tfstate"
    error_message = "La identidad y el estado deben pertenecer al mismo entorno."
  }
  assert {
    condition     = google_storage_bucket.state.force_destroy == false && google_storage_bucket.state.public_access_prevention == "enforced" && google_storage_bucket.state.versioning[0].enabled
    error_message = "El estado no puede ser público, perder versiones ni borrarse recursivamente."
  }
  assert {
    condition     = alltrue([for claim in ["assertion.repository_id == '1355247115'", "assertion.repository_owner_id == '55759561'", "assertion.ref == 'refs/heads/dev'", "assertion.environment == 'dev'", "assertion.event_name == 'push'", "assertion.workflow_ref == 'csotogd/room-designer/.github/workflows/ci.yml@refs/heads/dev'"] : strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, claim)])
    error_message = "WIF debe rechazar otro repo, propietario, rama, evento, entorno o workflow."
  }
  assert {
    condition     = !contains(local.deploy_roles, "roles/owner") && !contains(local.deploy_roles, "roles/editor")
    error_message = "La entrega no utiliza los roles básicos Owner o Editor."
  }
  assert {
    condition     = contains(local.apis, "cloudbuild.googleapis.com") && google_service_account.build.account_id == "rd-dev-build"
    error_message = "Cloud Build debe estar habilitado con identidad propia por entorno."
  }
  assert {
    condition     = google_storage_bucket.build_source.name == "designer-dev-123-build-source" && google_storage_bucket_iam_member.build_reads_source.role == "roles/storage.objectViewer" && google_artifact_registry_repository_iam_member.build_publishes.role == "roles/artifactregistry.writer"
    error_message = "El builder solo necesita leer fuentes, escribir logs y publicar imágenes, no desplegar."
  }
}
