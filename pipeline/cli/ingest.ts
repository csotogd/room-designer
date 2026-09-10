/**
 * Ingesta de catálogo: consume una fuente (tienda scrapeada o biblioteca 3D
 * con API) y materializa productos + imágenes + modelos nativos en la
 * carpeta-bucket local.
 *
 *   npm run pipeline:ingest -- --site sklum --limit 20
 *   npm run pipeline:ingest -- --site polyhaven          # completo, CC0
 *   SKETCHFAB_API_TOKEN=... npm run pipeline:ingest -- --site sketchfab
 *
 * Fuentes con modelo 3D nativo (polyhaven, sketchfab): el GLB/glTF se
 * descarga aquí y el producto queda aprobado sin pasar por generación ni
 * juez. La ingesta es reanudable: lo ya descargado (hash de la fuente) se
 * conserva vía carryOverGeneration.
 */
import { JsonLdCatalogScraper } from '../adapters/JsonLdCatalogScraper'
import { LocalFolderAssetStore } from '../adapters/LocalFolderAssetStore'
import { PolyHavenCatalogScraper } from '../adapters/PolyHavenCatalogScraper'
import { SketchfabCatalogScraper, resolveGlbUrl } from '../adapters/SketchfabCatalogScraper'
import { pickPackshot } from '../adapters/packshot'
import { SITES, defaultSiteId } from '../adapters/sites'
import { furnitureDimsFromGlb } from '../core/glb'
import { carryOverGeneration, type CatalogScraper, type ScrapedProduct } from '../core/types'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')
}

const siteId = args.get('site') ?? defaultSiteId()
const root = args.get('out') ?? 'data/catalog'

const site = SITES[siteId]
if (!site) {
  console.error(`Sitio desconocido "${siteId}". Disponibles: ${Object.keys(SITES).join(', ')}`)
  process.exit(1)
}
const kind = site.kind ?? 'jsonld'
// Las bibliotecas 3D se ingieren enteras por defecto; las tiendas, por lotes.
const limit = Number(args.get('limit') ?? (kind === 'jsonld' ? 20 : Infinity))

const scraper: CatalogScraper =
  kind === 'polyhaven'
    ? new PolyHavenCatalogScraper()
    : kind === 'sketchfab'
      ? new SketchfabCatalogScraper()
      : new JsonLdCatalogScraper(site)

const store = new LocalFolderAssetStore(root)

console.log(`Ingesta de ${siteId} (${kind}, límite ${limit})…`)
const previous = new Map((await store.readProducts(siteId)).map((p) => [p.id, p]))
const products = await scraper.scrape(limit)
console.log(`${products.length} productos anunciados por la fuente`)

const fetchBytes = async (url: string, headers?: Record<string, string>): Promise<Uint8Array> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', ...headers },
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      if (attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
    }
  }
}

// Sin token de Sketchfab no hay descarga de GLB posible: se avisa UNA vez y
// la ingesta sigue en modo solo-metadatos (fotos, licencia, descripción),
// en vez de fallar producto a producto con el mismo error.
const sketchfabToken = process.env.SKETCHFAB_API_TOKEN
let modelsSkippedForToken = 0
if (kind === 'sketchfab' && !sketchfabToken) {
  console.warn(
    '\n⚠ SKETCHFAB_API_TOKEN no está definido: se ingieren metadatos y fotos, ' +
      'pero NO se descargan modelos. Token gratuito: sketchfab.com → ajustes → API token.\n',
  )
}

/** Descarga el modelo nativo del producto y completa medidas si faltan. */
async function materializeNativeModel(product: ScrapedProduct): Promise<void> {
  const source = product.modelSource
  if (!source || product.modelPath) return

  if (source.kind === 'glb') {
    let url = source.url
    // El endpoint de descarga de Sketchfab canjea token por URL temporal.
    if (url.includes('api.sketchfab.com') && url.endsWith('/download')) {
      if (!sketchfabToken) {
        modelsSkippedForToken += 1
        return
      }
      url = await resolveGlbUrl(source.url, sketchfabToken)
    }
    const bytes = await fetchBytes(url)
    product.modelPath = await store.saveModel(product.site, product.id, bytes)
    if (!product.widthCm || !product.heightCm) {
      const dims = furnitureDimsFromGlb(bytes)
      if (dims) {
        product.widthCm ??= dims.widthCm
        product.depthCm ??= dims.depthCm
        product.heightCm ??= dims.heightCm
      }
    }
  } else {
    for (const [relPath, url] of Object.entries(source.files)) {
      const saved = await store.saveModelPart(product.site, product.id, relPath, await fetchBytes(url))
      if (relPath === source.entry) product.modelPath = saved
    }
  }
  // El modelo viene hecho de la fuente: no pasa por generación ni juez.
  product.quality = { status: 'approved', judge: `native-${product.site}` }
}

let done = 0
let modelErrors = 0
for (const product of products) {
  try {
    product.imagePath = await store.saveImage(siteId, product.id, await fetchBytes(product.imageUrl))

    if (kind === 'jsonld') {
      // Tiendas: elegir packshot (producto solo) de la galería para generar 3D.
      const candidates = [product.imageUrl, ...(product.galleryUrls ?? [])]
      const packshot = await pickPackshot(candidates, fetchBytes)
      if (packshot) {
        product.generationImagePath = await store.saveGenerationImage(siteId, product.id, packshot.bytes)
        product.generationImageUrl = packshot.url
      }
    } else {
      // Bibliotecas 3D: la miniatura ya es un render limpio del producto solo;
      // sirve tal cual de foto de embedding (gen-image).
      product.generationImagePath = await store.saveGenerationImage(
        siteId,
        product.id,
        await fetchBytes(product.imageUrl),
      )
      product.generationImageUrl = product.imageUrl
    }

    carryOverGeneration(previous.get(product.id), product)
    try {
      await materializeNativeModel(product)
    } catch (error) {
      modelErrors += 1
      console.warn(`[modelo-err] ${product.id}: ${String(error).slice(0, 160)}`)
    }

    done += 1
    const dims = `${product.widthCm ?? '?'}×${product.depthCm ?? '?'}×${product.heightCm ?? '?'} cm`
    console.log(
      `[ok ${done}/${products.length}] ${product.name.slice(0, 44).padEnd(44)} ${dims} ${product.modelPath ? '· 3D' : ''}`,
    )
  } catch (error) {
    console.warn(`[img-err] ${product.id}: ${String(error)}`)
  }

  // Checkpoint periódico: una ingesta larga interrumpida se reanuda sin
  // perder lo ya materializado (la siguiente pasada lo conserva por hash).
  if (done % 25 === 0 && done > 0) {
    await checkpoint()
  }
}

async function checkpoint(): Promise<void> {
  const scrapedIds = new Set(products.map((p) => p.id))
  const kept = [...previous.values()].filter((p) => !scrapedIds.has(p.id))
  await store.saveProducts(siteId, [...products.filter((p) => p.imagePath), ...kept])
}

// Ingesta aditiva: lo materializado en pasadas anteriores (imágenes y modelos
// ya guardados) se conserva aunque esta pasada no haya visitado ese producto.
const scrapedIds = new Set(products.map((p) => p.id))
const kept = [...previous.values()].filter((p) => !scrapedIds.has(p.id))
const all = [...products.filter((p) => p.imagePath), ...kept]

await store.saveProducts(siteId, all)
const withModel = all.filter((p) => p.modelPath).length
console.log(
  `\n${products.length} escaneados + ${kept.length} conservados = ${all.length} productos (${withModel} con 3D, ${modelErrors} fallos de modelo) → ${store.absolute(`${siteId}/products.json`)}`,
)
if (modelsSkippedForToken > 0) {
  console.warn(
    `⚠ ${modelsSkippedForToken} modelos sin descargar por falta de SKETCHFAB_API_TOKEN; ` +
      'con el token en .env, re-ejecuta esta ingesta y solo bajará lo que falte.',
  )
}
