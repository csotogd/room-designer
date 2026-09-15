output "assets_bucket" {
  description = "Bucket de imágenes, previews y GLBs"
  value       = google_storage_bucket.assets.name
}

output "assets_base_url" {
  description = "URL base privada; necesita identidad autorizada"
  value       = "https://storage.googleapis.com/${google_storage_bucket.assets.name}"
}

output "pubsub_topic" {
  description = "Cola de productos pendientes de generación"
  value       = google_pubsub_topic.products_to_generate.id
}

output "generator_url" {
  description = "Servicio de generación (interno, invocado por Pub/Sub)"
  value       = try(google_cloud_run_v2_service.generator[0].uri, null)
}

output "artifact_repo" {
  description = "Repositorio de la imagen del pipeline"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${data.google_artifact_registry_repository.pipeline.repository_id}"
}

output "frontend_url" {
  description = "Editor privado en Cloud Run; no concede acceso anónimo"
  value       = google_cloud_run_v2_service.frontend.uri
}

output "catalog_runtime_enabled" {
  description = "Distingue los recursos base del pipeline aún pendiente de implementación"
  value       = var.enable_catalog_runtime
}

output "scheduled_ingests" {
  description = "Ingestas programadas por sitio/país"
  value       = { for k, job in google_cloud_scheduler_job.ingest : k => job.schedule }
}
