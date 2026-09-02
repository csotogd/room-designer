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

    for (const categoryUrl of this.config.categoryUrls) {
      if (products.length >= limit) break
      let links: string[]
      try {
        links = extractProductLinks(
          await this.fetchText(categoryUrl),
          this.config.productLinkPattern,
          this.config.origin,
        )
      } catch (error) {
        console.warn(`[scraper] categoría inaccesible ${categoryUrl}: ${String(error)}`)
        continue
      }

      for (const url of links) {
        if (products.length >= limit) break
        if (visited.has(url)) continue
        visited.add(url)
        try {
          const product = extractJsonLdProduct(await this.fetchText(url), url, this.config.id)
          if (product && product.widthCm && product.heightCm) {
            products.push(product)
          }
          await sleep(this.delayMs)
        } catch (error) {
          console.warn(`[scraper] producto fallido ${url}: ${String(error)}`)
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
