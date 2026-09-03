/**
 * Publica el bucket local en la app: copia imágenes y modelos a public/catalog
 * y escribe public/catalog/index.json con las entradas listas para el front.
 *
 *   npm run pipeline:link -- --site sklum
 */
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LocalFolderAssetStore } from '../adapters/LocalFolderAssetStore'
import { toAppCatalogEntry } from '../core/appCatalog'
import { syncSearchIndex, toSearchProducts } from '../core/searchSync'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')
}
const siteId = args.get('site') ?? 'sklum'
const root = args.get('out') ?? 'data/catalog'
const publicDir = join('public', 'catalog')

const store = new LocalFolderAssetStore(root)
const products = await store.readProducts(siteId)

await mkdir(join(publicDir, siteId), { recursive: true })
// gen-images son los packshots (producto solo): los usa el embedding de búsqueda.
for (const sub of ['images', 'gen-images', 'models']) {
  const source = store.absolute(join(siteId, sub))
  if (existsSync(source)) {
    await cp(source, join(publicDir, siteId, sub), { recursive: true })
  }
}

const entries = products
  .map((p) => toAppCatalogEntry(p, '/catalog'))
  .filter((e) => e !== null)
await writeFile(join(publicDir, 'index.json'), JSON.stringify(entries, null, 2))

const withModel = entries.filter((e) => e!.assets.modelUrl).length
console.log(
  `${entries.length} productos publicados en ${publicDir} (${withModel} con modelo 3D)`,
)

// El refresco del catálogo dispara la sincronización de embeddings: el
// servicio añade los nuevos, actualiza los cambiados y borra los retirados.
// El runId aparece en los logs del servicio (x-request-id): una ejecución
// del link se puede seguir de punta a punta.
const runId = `link-${siteId}-${Date.now().toString(36)}`
const searchUrl = process.env.SEARCH_URL ?? 'http://localhost:8787'
const sync = await syncSearchIndex(
  toSearchProducts(entries, process.env.CATALOG_PUBLIC_BASE_URL),
  searchUrl,
  process.env.SEARCH_SYNC_TOKEN,
  runId,
)
if (sync.ok) console.log(`[${runId}] índice de búsqueda sincronizado (${searchUrl}): ${sync.detail}`)
else console.warn(`[${runId}] aviso: búsqueda no sincronizada (${searchUrl}): ${sync.detail}`)
process.exit(0)
