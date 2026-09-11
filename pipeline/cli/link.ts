/**
 * Publica el bucket local en la app: copia imágenes y modelos a public/catalog
 * y escribe public/catalog/index-<site>.json con las entradas listas para el
 * front. Si el sitio es el activo (CATALOG_SITE), también refresca el
 * index.json histórico que consumen los clientes sin variable configurada.
 *
 *   npm run pipeline:link -- --site polyhaven
 */
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LocalFolderAssetStore } from '../adapters/LocalFolderAssetStore'
import { defaultSiteId } from '../adapters/sites'
import { toAppCatalogEntry } from '../core/appCatalog'
import { syncSearchIndex, toSearchProducts } from '../core/searchSync'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')
}
const siteId = args.get('site') ?? defaultSiteId()
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
await writeFile(join(publicDir, `index-${siteId}.json`), JSON.stringify(entries, null, 2))
// El índice sin sufijo sigue al catálogo activo: front antiguo y CLIs sin
// --site leen siempre el catálogo elegido por CATALOG_SITE.
if (siteId === defaultSiteId()) {
  await writeFile(join(publicDir, 'index.json'), JSON.stringify(entries, null, 2))
}

const withModel = entries.filter((e) => e!.assets.modelUrl).length
console.log(
  `${entries.length} productos publicados en ${publicDir} (${withModel} con modelo 3D)`,
)

// El refresco del catálogo dispara la sincronización de embeddings: el
// servicio añade los nuevos, actualiza los cambiados y borra los retirados.
// El runId aparece en los logs del servicio (x-request-id): una ejecución
// del link se puede seguir de punta a punta.
// El servicio de búsqueda vivo indexa UN catálogo (el activo): sincronizar
// aquí otro sitio machacaría su índice. Para construir el índice de un sitio
// no activo, levanta un servicio apuntando a su carpeta:
//   CATALOG_SITE=<site> npm run search:serve   +   CATALOG_SITE=<site> link
if (siteId !== defaultSiteId()) {
  console.log(
    `Catálogo activo: ${defaultSiteId()} — no se sincroniza el índice de ${siteId}. ` +
      `Para activarlo: CATALOG_SITE=${siteId} en .env y reiniciar search:serve.`,
  )
  process.exit(0)
}
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
