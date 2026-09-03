import { Product, type ProductData } from '../../core/model/Product'
import type { CatalogItem } from '../../core/model/CatalogItem'
import type { FurnitureCatalog } from './FurnitureCatalog'

/**
 * Productos publicados por el pipeline (public/catalog/index.json — mañana,
 * la respuesta de CatalogService). Si no existe el índice, lista vacía.
 */
export async function loadRemoteProducts(url = '/catalog/index.json'): Promise<Product[]> {
  try {
    const response = await fetch(url)
    if (!response.ok) return []
    const entries = (await response.json()) as ProductData[]
    return entries.map((entry) => new Product(entry))
  } catch {
    return []
  }
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
