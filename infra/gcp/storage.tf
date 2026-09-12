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
  force_destroy               = false
  public_access_prevention    = "enforced"
  versioning { enabled = true }

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

# La publicación selectiva del catálogo se implementará con los adaptadores;
# no se expone el bucket de trabajo completo a Internet.

# ── Firestore: un catálogo por proveedor/país ──────────────────────────────
# Colecciones: catalog_{site}_{country} — documentos con precio, descripción
# extensa, medidas 3D (cm), enlace al GLB en GCS y veredicto del juez.

resource "google_firestore_database" "catalog" {
  name                    = "(default)"
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
}
