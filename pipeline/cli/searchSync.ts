/**
 * Sincroniza el índice de búsqueda con el catálogo publicado, como paso
 * independiente y orquestable (tarea propia en Airflow, con sus reintentos):
 *
 *   npm run search:sync              # POST /sync con la instantánea completa
 *   npm run search:sync -- --verify  # además verifica catálogo ≡ índice
 *
 * La instantánea completa hace las tres cosas de una vez: crea embeddings de
 * los productos nuevos, actualiza los cambiados y BORRA los de productos que
 * ya no están mantenidos en el catálogo. Es idempotente (hashes de
 * contenido): re-ejecutar tras un fallo parcial es siempre seguro.
 *
 * --verify es la puerta de reconciliación: compara el nº de productos del
 * catálogo publicado con el del índice (/healthz) y sale con código ≠ 0 si
 * difieren, para que el orquestador alerte en vez de dejar deriva silenciosa.
 *
 * Entorno: SEARCH_URL, SEARCH_SYNC_TOKEN, CATALOG_PUBLIC_BASE_URL.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { syncSearchIndex, toSearchProducts } from '../core/searchSync'
import type { AppCatalogEntry } from '../core/appCatalog'

const verify = process.argv.includes('--verify')
const indexPath = join('public', 'catalog', 'index.json')
const searchUrl = process.env.SEARCH_URL ?? 'http://localhost:8787'
const runId = `sync-${Date.now().toString(36)}`

const entries = JSON.parse(await readFile(indexPath, 'utf8')) as AppCatalogEntry[]
const products = toSearchProducts(entries, process.env.CATALOG_PUBLIC_BASE_URL)

const result = await syncSearchIndex(
  products,
  searchUrl,
  process.env.SEARCH_SYNC_TOKEN,
  runId,
)
if (!result.ok) {
  console.error(`[${runId}] sync fallido contra ${searchUrl}: ${result.detail}`)
  process.exit(1)
}
console.log(`[${runId}] ${result.detail}`)

if (verify) {
  const health = (await (await fetch(`${searchUrl}/healthz`)).json()) as { products: number }
  if (health.products !== products.length) {
    console.error(
      `[${runId}] DERIVA: catálogo=${products.length} productos, índice=${health.products}`,
    )
    process.exit(1)
  }
  console.log(`[${runId}] consistencia verificada: catálogo ≡ índice (${health.products})`)
}
process.exit(0)
