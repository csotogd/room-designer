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
for (const sub of ['images', 'models']) {
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
process.exit(0)
