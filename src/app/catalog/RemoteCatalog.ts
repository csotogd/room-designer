import { Product, type ProductData } from '../../core/model/Product'
import type { CatalogItem } from '../../core/model/CatalogItem'
import type { FurnitureCatalog } from './FurnitureCatalog'

/**
 * Productos publicados por el pipeline (public/catalog/index-<site>.json —
 * mañana, la respuesta de CatalogService). El catálogo activo lo decide la
 * variable de entorno CATALOG_SITE (expuesta por Vite); sin ella, o si el
 * índice del sitio no existe, se cae al index.json histórico.
 */
export async function loadRemoteProducts(url?: string): Promise<Product[]> {
  const site = (import.meta.env?.CATALOG_SITE as string | undefined)?.trim()
  const candidates = url
    ? [url]
    : [...(site ? [`/catalog/index-${site}.json`] : []), '/catalog/index.json']
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate)
      if (!response.ok) continue
      const entries = (await response.json()) as ProductData[]
      return entries.map((entry) => new Product(entry))
    } catch {
      // probar el siguiente candidato
    }
  }
  return []
}

/** Catálogo compuesto: los locales primero, luego los remotos (sin duplicar id). */
export class CompositeCatalog implements FurnitureCatalog {
  private readonly all: CatalogItem[]

  constructor(...catalogs: readonly (readonly CatalogItem[])[]) {
    const seen = new Set<string>()
    this.all = []
    for (const catalog of catalogs) {
      for (const item of catalog) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        this.all.push(item)
      }
    }
  }

  items(): readonly CatalogItem[] {
    return this.all
  }

  get(id: string): CatalogItem {
    const item = this.all.find((i) => i.id === id)
    if (!item) throw new Error(`Artículo desconocido en el catálogo: "${id}"`)
    return item
  }
}
