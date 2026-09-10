import type { CatalogScraper, ScrapedProduct } from '../core/types'

const API = 'https://api.polyhaven.com'

interface PolyHavenAsset {
  name: string
  description?: string
  category?: string
  categories?: string[]
  tags?: string[]
  authors?: Record<string, string>
  /** [ancho, fondo, alto] en milímetros (convención z-up de Blender). */
  dimensions?: [number, number, number]
  files_hash?: string
}

interface PolyHavenFileEntry {
  url: string
  size: number
  md5: string
}

interface PolyHavenGltfFiles {
  gltf?: Record<
    string,
    { gltf?: PolyHavenFileEntry & { include?: Record<string, PolyHavenFileEntry> } }
  >
}

type FetchJson = (url: string) => Promise<unknown>

/**
 * Catálogo de Poly Haven vía su API pública (sin credenciales). Todos los
 * assets son CC0: uso comercial, redistribución y modificación libres. Los
 * modelos llegan como glTF multi-fichero (.gltf + .bin + texturas) a la
 * resolución elegida; las dimensiones físicas las publica la propia API.
 */
export class PolyHavenCatalogScraper implements CatalogScraper {
  constructor(
    private readonly fetchJson: FetchJson = defaultFetchJson,
    /** Resolución de texturas a descargar: 1k basta para el visor de la app. */
    private readonly resolution = '1k',
    private readonly concurrency = 6,
  ) {}

  async scrape(limit: number): Promise<ScrapedProduct[]> {
    const assets = (await this.fetchJson(`${API}/assets?type=models`)) as Record<
      string,
      PolyHavenAsset
    >
    const slugs = Object.keys(assets).slice(0, limit)
    const products: ScrapedProduct[] = []

    // El manifiesto de ficheros es una llamada por asset: se piden en lotes
    // pequeños por cortesía con una API gratuita.
    for (let start = 0; start < slugs.length; start += this.concurrency) {
      const batch = slugs.slice(start, start + this.concurrency)
      const results = await Promise.allSettled(
        batch.map(async (slug) => this.toProduct(slug, assets[slug]!)),
      )
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled' && result.value) products.push(result.value)
        else if (result.status === 'rejected')
          console.warn(`[polyhaven] ${batch[index]}: ${String(result.reason)}`)
      }
    }
    return products
  }

  private async toProduct(slug: string, meta: PolyHavenAsset): Promise<ScrapedProduct | null> {
    const files = (await this.fetchJson(`${API}/files/${slug}`)) as PolyHavenGltfFiles
    const variant = files.gltf?.[this.resolution] ?? files.gltf?.[Object.keys(files.gltf ?? {})[0] ?? '']
    const entryFile = variant?.gltf
    if (!entryFile?.url) return null // sin glTF publicado: no nos sirve

    const entryName = `${slug}.gltf`
    const modelFiles: Record<string, string> = { [entryName]: entryFile.url }
    for (const [relPath, part] of Object.entries(entryFile.include ?? {})) {
      modelFiles[relPath] = part.url
    }

    const [widthMm, depthMm, heightMm] = meta.dimensions ?? []
    const toCm = (mm?: number) => (mm ? Math.round(mm) / 10 : undefined)
    const description = [
      meta.description ?? meta.name,
      meta.category,
      meta.tags?.join(', '),
    ]
      .filter(Boolean)
      .join(' · ')

    return {
      id: slug,
      site: 'polyhaven',
      country: 'int',
      sourceUrl: `https://polyhaven.com/a/${slug}`,
      name: meta.name,
      description,
      imageUrl: `https://cdn.polyhaven.com/asset_img/thumbs/${slug}.png?width=512&height=512`,
      license: 'CC0',
      author: Object.keys(meta.authors ?? {}).join(', ') || undefined,
      widthCm: toCm(widthMm),
      depthCm: toCm(depthMm),
      heightCm: toCm(heightMm),
      extraDims: {},
      modelSource: { kind: 'gltf-files', entry: entryName, files: modelFiles },
      modelSourceHash: meta.files_hash,
    }
  }
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`)
  return response.json()
}
