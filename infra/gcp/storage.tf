# ── Bucket de assets: el equivalente cloud de data/catalog ─────────────────
# Layout de claves idéntico al local:
#   <site>-<country>/images/<id>.jpg
#   <site>-<country>/gen-images/<id>.jpg
#   <site>-<country>/previews/<id>.webp
#   <site>-<country>/models/<id>.glb

resource "google_storage_bucket" "assets" {
  name                        = "${var.project_id}-${local.prefix}-assets"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = var.environment != "prod"

  cors {
    origin          = ["*"] # restringir al dominio del front en prod
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age            = 30
      matches_prefix = ["tmp/"]
    }
  }
}

# Los GLB y fotos publicados se sirven en lectura pública (catálogo web).
resource "google_storage_bucket_iam_member" "assets_public_read" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# ── Firestore: un catálogo por proveedor/país ──────────────────────────────
# Colecciones: catalog_{site}_{country} — documentos con precio, descripción
# extensa, medidas 3D (cm), enlace al GLB en GCS y veredicto del juez.

resource "google_firestore_database" "catalog" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.apis]
}
