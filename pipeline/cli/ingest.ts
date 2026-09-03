/**
 * Ingesta de catálogo: scrapea un sitio y materializa productos + imágenes
 * en la carpeta-bucket local.
 *
 *   npm run pipeline:ingest -- --site sklum --limit 20
 */
import { JsonLdCatalogScraper } from '../adapters/JsonLdCatalogScraper'
import { LocalFolderAssetStore } from '../adapters/LocalFolderAssetStore'
import { pickPackshot } from '../adapters/packshot'
import { SITES } from '../adapters/sites'
import { carryOverGeneration } from '../core/types'

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
const previous = new Map((await store.readProducts(siteId)).map((p) => [p.id, p]))
const products = await scraper.scrape(limit)

const fetchBytes = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

for (const product of products) {
  try {
    // Foto de tarjeta: la principal (bodegón, queda bien en el catálogo).
    product.imagePath = await store.saveImage(siteId, product.id, await fetchBytes(product.imageUrl))

    // Foto de generación 3D: el packshot (producto solo) de entre la galería.
    const candidates = [product.imageUrl, ...(product.galleryUrls ?? [])]
    const packshot = await pickPackshot(candidates, fetchBytes)
    if (packshot) {
      product.generationImagePath = await store.saveGenerationImage(siteId, product.id, packshot.bytes)
      product.generationImageUrl = packshot.url
    }

    carryOverGeneration(previous.get(product.id), product)
    console.log(
      `[ok] ${product.name.slice(0, 44).padEnd(44)} ${product.widthCm}×${product.depthCm}×${product.heightCm} cm  packshot: ${packshot ? Math.round(packshot.score) : 'no'} (${candidates.length} candidatas)`,
    )
  } catch (error) {
    console.warn(`[img-err] ${product.id}: ${String(error)}`)
  }
}

await store.saveProducts(siteId, products)
console.log(`\n${products.length} productos → ${store.absolute(`${siteId}/products.json`)}`)
