import type { CatalogScraper, ScrapedProduct } from '../core/types'

const API = 'https://api.sketchfab.com/v3'

/** Licencias admitidas: dominio público y CC-BY (comercial con atribución). */
const LICENSES = ['cc0', 'by'] as const

interface SketchfabResult {
  uid: string
  name: string
  description?: string
  viewerUrl?: string
  publishedAt?: string
  updatedAt?: string
  isDownloadable?: boolean
  license?: { label?: string }
  user?: { username?: string }
  tags?: { name?: string }[]
  thumbnails?: { images?: { width?: number; url?: string }[] }
  archives?: { glb?: { size?: number } }
}

interface SketchfabPage {
  results?: SketchfabResult[]
  next?: string | null
}

type FetchJson = (url: string) => Promise<unknown>

/**
 * Catálogo de Sketchfab: búsqueda pública de modelos descargables de la
 * categoría hogar/mobiliario con licencia CC0 o CC-BY. La búsqueda y las
 * miniaturas no requieren credenciales; DESCARGAR los GLB sí (cuenta
 * gratuita → SKETCHFAB_API_TOKEN), vía resolveGlbUrl en la ingesta.
 *
 * Atribución CC-BY: license y author viajan en cada producto y el catálogo
 * de la app los publica; no retirar ese dato de la UI.
 */
export class SketchfabCatalogScraper implements CatalogScraper {
  constructor(
    private readonly fetchJson: FetchJson = defaultFetchJson,
    private readonly category = 'furniture-home',
    /** GLB por encima de este tamaño no compensan en un visor web. */
    private readonly maxGlbBytes = 40 * 1024 * 1024,
  ) {}

  async scrape(limit: number): Promise<ScrapedProduct[]> {
    const products: ScrapedProduct[] = []
    const seen = new Set<string>()
    for (const license of LICENSES) {
      let url: string | null =
        `${API}/search?type=models&downloadable=true&license=${license}` +
        `&categories=${this.category}&count=24`
      while (url && products.length < limit) {
        const page = (await this.fetchJson(url)) as SketchfabPage
        for (const result of page.results ?? []) {
          if (products.length >= limit) break
          const product = this.toProduct(result)
          if (product && !seen.has(product.id)) {
            seen.add(product.id)
            products.push(product)
          }
        }
        url = page.next ?? null
      }
    }
    return products
  }

  private toProduct(result: SketchfabResult): ScrapedProduct | null {
    if (!result.isDownloadable) return null
    const glbSize = result.archives?.glb?.size ?? 0
    if (!glbSize || glbSize > this.maxGlbBytes) return null
    const thumbnail = pickThumbnail(result.thumbnails?.images ?? [])
    if (!thumbnail) return null

    const tags = (result.tags ?? []).map((tag) => tag.name).filter(Boolean)
    const description = [result.description?.trim(), tags.join(', ')]
      .filter(Boolean)
      .join(' · ')

    return {
      id: result.uid,
      site: 'sketchfab',
      country: 'int',
      sourceUrl: result.viewerUrl ?? `https://sketchfab.com/3d-models/${result.uid}`,
      name: result.name,
      description: description || result.name,
      imageUrl: thumbnail,
      license: result.license?.label,
      author: result.user?.username,
      extraDims: {},
      // Las medidas no las publica la API: se calculan del GLB al descargarlo.
      modelSource: { kind: 'glb', url: `${API}/models/${result.uid}/download` },
      modelSourceHash: `${result.updatedAt ?? result.publishedAt ?? ''}:${glbSize}`,
    }
  }
}

/**
 * Cambia el endpoint de descarga por la URL temporal del GLB. Requiere el
 * token de una cuenta de Sketchfab (gratuita): sin él, la API responde 401.
 */
export async function resolveGlbUrl(
  downloadEndpoint: string,
  token: string,
  fetchJson: (url: string, headers?: Record<string, string>) => Promise<unknown> = defaultFetchJson,
): Promise<string> {
  const payload = (await fetchJson(downloadEndpoint, { Authorization: `Token ${token}` })) as {
    glb?: { url?: string }
  }
  if (!payload.glb?.url) throw new Error('La descarga no devolvió URL de GLB')
  return payload.glb.url
}

function pickThumbnail(images: { width?: number; url?: string }[]): string | undefined {
  const sorted = images
    .filter((image) => image.url && image.width)
    .sort((a, b) => a.width! - b.width!)
  // La más pequeña que llegue a 512 px; si ninguna llega, la mayor disponible.
  return (sorted.find((image) => image.width! >= 512) ?? sorted.at(-1))?.url
}

async function defaultFetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`)
  return response.json()
}
