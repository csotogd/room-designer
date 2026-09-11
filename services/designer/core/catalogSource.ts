import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CatalogProduct, CatalogSource } from './types'

/**
 * Catálogo publicado leído del fichero del pipeline (index-<site>.json).
 * Da al servicio las MEDIDAS reales (guardrails) y la foto (picker VLM).
 */
export class FileCatalogSource implements CatalogSource {
  private readonly byId = new Map<string, CatalogProduct>()

  constructor(indexPath: string) {
    const entries = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      id: string
      name: string
      description: string
      price: number
      width: number
      depth: number
      height: number
      assets: { imageUrl?: string; packshotUrl?: string }
    }[]
    for (const e of entries) {
      this.byId.set(e.id, {
        id: e.id,
        name: e.name,
        description: e.description,
        price: e.price,
        width: e.width,
        depth: e.depth,
        height: e.height,
        imageUrl: e.assets.imageUrl,
        packshotUrl: e.assets.packshotUrl,
      })
    }
  }

  get(id: string): CatalogProduct | undefined {
    return this.byId.get(id)
  }

  count(): number {
    return this.byId.size
  }

  /** Resumen corto para el prompt del cerebro (qué hay en el catálogo). */
  summary(sample = 12): string {
    const names = [...this.byId.values()].slice(0, sample).map((p) => p.name)
    return `${this.byId.size} productos (p. ej.: ${names.join(' · ')})`
  }
}

export function defaultCatalogIndexPath(): string {
  const site = process.env.CATALOG_SITE ?? 'sklum'
  const siteIndex = join('public', 'catalog', `index-${site}.json`)
  return existsSync(siteIndex) ? siteIndex : join('public', 'catalog', 'index.json')
}
