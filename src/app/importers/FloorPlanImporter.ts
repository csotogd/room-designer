import type { FloorPlan } from '../../core/model/FloorPlan'

/**
 * Punto de extensión: cualquier fuente capaz de producir un plano.
 * Hoy, el editor manual. Mañana, un importador "foto → plano" (visión por
 * computador) que implemente esta misma interfaz — nada más de la app cambia.
 */
export interface ImportSource {
  readonly kind: 'photo' | 'blank'
  /** Imagen de la que extraer el plano, cuando kind === 'photo'. */
  readonly image?: Blob
}

export interface FloorPlanImporter {
  import(source: ImportSource): Promise<FloorPlan>
}
