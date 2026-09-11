import type { CatalogScraper, ScrapedProduct, SiteConfig } from '../core/types'
import { extractJsonLdProduct, extractProductLinks } from './jsonld'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

/**
 * Scraper genérico para sitios que publican schema.org/Product en JSON-LD
 * (la mayoría de e-commerce serios: Sklum, Leroy Merlin, etc.). Solo cambia
 * la SiteConfig por sitio.
 */
export class JsonLdCatalogScraper implements CatalogScraper {
  constructor(
    private readonly config: SiteConfig,
    private readonly fetchText: (url: string) => Promise<string> = defaultFetch,
    private readonly delayMs = 600,
  ) {}

  async scrape(limit: number): Promise<ScrapedProduct[]> {
    const products: ScrapedProduct[] = []
    const visited = new Set<string>()

    // Colas de enlaces por categoría: el límite se reparte en turnos (una de
    // cada categoría por ronda) para que el catálogo salga variado en vez de
    // agotarse en la primera categoría.
    const { categoryUrls, productLinkPattern } = this.config
    if (!categoryUrls?.length || !productLinkPattern) {
      throw new Error(`El sitio "${this.config.id}" no tiene categoryUrls/productLinkPattern (¿kind equivocado?)`)
    }
    const queues: string[][] = []
    for (const categoryUrl of categoryUrls) {
      try {
        queues.push(
          extractProductLinks(
            await this.fetchText(categoryUrl),
            productLinkPattern,
            this.config.origin,
          ),
        )
      } catch (error) {
        console.warn(`[scraper] categoría inaccesible ${categoryUrl}: ${String(error)}`)
      }
    }

    let remaining = true
    while (products.length < limit && remaining) {
      remaining = false
      for (const queue of queues) {
        if (products.length >= limit) break
        const url = queue.shift()
        if (!url) continue
        remaining = true
        if (visited.has(url)) continue
        visited.add(url)
        try {
          const product = extractJsonLdProduct(await this.fetchText(url), url, this.config.id)
          if (product && product.widthCm && product.heightCm) {
            product.country = this.config.country
            products.push(product)
          }
          await sleep(this.delayMs)
        } catch (error) {
          console.warn(`[scraper] producto fallido ${url}: ${String(error)}`)
          // Cortesía también al fallar: si el sitio devuelve errores (429,
          // caída), es exactamente cuando NO hay que martillearlo.
          await sleep(this.delayMs * 2)
        }
      }
    }
    return products
  }
}

async function defaultFetch(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
