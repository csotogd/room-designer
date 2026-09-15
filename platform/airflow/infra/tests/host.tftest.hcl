mock_provider "google" {}

variables {
  project_id         = "designer-test-123"
  environment        = "dev"
  notification_email = "operator@example.test"
  airflow_image      = "europe-west1-docker.pkg.dev/designer-test-123/room-designer-dev-pipeline/airflow@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

run "private_panel_and_durable_state" {
  command = plan
  assert {
    condition     = google_compute_instance.airflow.name == "rd-dev-airflow" && google_compute_instance.airflow.deletion_protection
    error_message = "La instancia debe pertenecer al entorno y estar protegida contra borrados."
  }
  assert {
    condition     = google_compute_firewall.iap.source_ranges == toset(["35.235.240.0/20"]) && one(one(google_compute_firewall.iap.allow).ports) == "22"
    error_message = "Solo se admite SSH desde IAP; el panel no puede publicarse."
  }
  assert {
    condition     = google_storage_bucket.backups.public_access_prevention == "enforced" && !google_storage_bucket.backups.force_destroy
    error_message = "Las copias contienen claves y nunca pueden ser públicas ni borrarse recursivamente."
  }
  assert {
    condition     = google_compute_disk.state.size == 50 && google_compute_resource_policy.backup.snapshot_schedule_policy[0].retention_policy[0].max_retention_days == 7
    error_message = "El disco y la retención deben permanecer acotados."
  }
}

run "isolated_stage" {
  command = plan
  variables {
    project_id  = "designer-stage-123"
    environment = "stage"
  }
  assert {
    condition     = google_service_account.airflow.account_id == "rd-stage-airflow" && google_storage_bucket.backups.name == "designer-stage-123-airflow-backups"
    error_message = "Stage debe usar identidades y copias propias."
  }
}

run "reject_mutable_image" {
  command = plan
  variables { airflow_image = "example.test/airflow:latest" }
  expect_failures = [var.airflow_image]
}

run "require_alert_destination" {
  command = plan
  variables { notification_email = "" }
  expect_failures = [var.notification_email]
}
