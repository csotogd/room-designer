import type { CatalogItem } from '../../core/model/CatalogItem'

/** Puerto del catálogo: hoy primitivas con medidas reales, mañana modelos GLB. */
export interface FurnitureCatalog {
  items(): readonly CatalogItem[]
  get(id: string): CatalogItem
}
