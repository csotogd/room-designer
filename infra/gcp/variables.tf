variable "project_id" {
  description = "ID del proyecto de GCP"
  type        = string
}

variable "region" {
  description = "Región por defecto"
  type        = string
  default     = "europe-west1"
}

variable "environment" {
  description = "Entorno (dev, staging, prod)"
  type        = string
  default     = "dev"
}

# Un catálogo por proveedor/país: cada entrada programa su propia ingesta.
variable "catalog_sources" {
  description = "Fuentes de catálogo: sitio web, país y cron de ingesta"
  type = list(object({
    site     = string # p.ej. "sklum"
    country  = string # p.ej. "es"
    schedule = string # cron de Cloud Scheduler, p.ej. "0 3 * * 1" (lunes 03:00)
    limit    = number # productos por ejecución
  }))
  default = [
    { site = "sklum", country = "es", schedule = "0 3 * * 1", limit = 200 },
  ]
}

variable "generator_provider" {
  description = "Proveedor de generación 3D (tripo | trellis-selfhost)"
  type        = string
  default     = "tripo"
}

variable "judge_provider" {
  description = "Proveedor del VLM juez (anthropic | openai | vertex)"
  type        = string
  default     = "anthropic"
}

variable "judge_model" {
  description = "Modelo del VLM juez"
  type        = string
  default     = "claude-sonnet-5"
}

# El juez VLM también elige la mejor imagen (packshot) entre la galería.
variable "vlm_image_selection_enabled" {
  description = "Usar VLM para elegir la imagen donde solo se ve el objeto"
  type        = bool
  default     = true
}

# 'Decodificar' la imagen con VLM/generativa cuando no existe packshot
# (recorte/síntesis). APAGADO por ahora por decisión de producto.
variable "vlm_image_decode_enabled" {
  description = "Derivar una imagen limpia con VLM cuando no hay packshot (OFF)"
  type        = bool
  default     = false
}

variable "pipeline_image_tag" {
  description = "Tag de la imagen de contenedor del pipeline"
  type        = string
  default     = "latest"
}
