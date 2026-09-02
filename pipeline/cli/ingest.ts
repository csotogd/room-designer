/**
 * Ingesta de catálogo: scrapea un sitio y materializa productos + imágenes
 * en la carpeta-bucket local.
 *
 *   npm run pipeline:ingest -- --site sklum --limit 20
 */
import { JsonLdCatalogScraper } from '../adapters/JsonLdCatalogScraper'
import { LocalFolderAssetStore } from '../adapters/LocalFolderAssetStore'
import { SITES } from '../adapters/sites'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')
}

const siteId = args.get('site') ?? 'sklum'
const limit = Number(args.get('limit') ?? 20)
const root = args.get('out') ?? 'data/catalog'

const site = SITES[siteId]
if (!site) {
  console.error(`Sitio desconocido "${siteId}". Disponibles: ${Object.keys(SITES).join(', ')}`)
  process.exit(1)
}

const store = new LocalFolderAssetStore(root)
const scraper = new JsonLdCatalogScraper(site)

console.log(`Ingesta de ${siteId} (límite ${limit})…`)
const products = await scraper.scrape(limit)

for (const product of products) {
  try {
    const response = await fetch(product.imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    product.imagePath = await store.saveImage(
      siteId,
      product.id,
      new Uint8Array(await response.arrayBuffer()),
    )
    console.log(
      `[ok] ${product.name.slice(0, 48).padEnd(48)} ${product.widthCm}×${product.depthCm}×${product.heightCm} cm  ${product.price ?? '?'} ${product.currency ?? ''}`,
    )
  } catch (error) {
    console.warn(`[img-err] ${product.id}: ${String(error)}`)
  }
}

await store.saveProducts(siteId, products)
console.log(`\n${products.length} productos → ${store.absolute(`${siteId}/products.json`)}`)
