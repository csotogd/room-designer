/**
 * Juez de calidad de modelos generados.
 *
 *   # Con VLM (cualquier proveedor):
 *   JUDGE_PROVIDER=anthropic JUDGE_API_KEY=... npm run pipeline:judge -- --site sklum
 *   JUDGE_PROVIDER=openai JUDGE_BASE_URL=http://localhost:11434/v1 ... (compatibles)
 *
 *   # Veredicto manual (humano en el bucle):
 *   npm run pipeline:judge -- --site sklum --set <productId>=rejected --reason "geometría rota"
 */
import { LocalFolderAssetStore } from '../adapters/LocalFolderAssetStore'
import { judgeFromEnv } from '../adapters/judges'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')
}
const siteId = args.get('site') ?? 'sklum'
const root = args.get('out') ?? 'data/catalog'

const store = new LocalFolderAssetStore(root)
const products = await store.readProducts(siteId)

const manual = args.get('set')
if (manual) {
  const separator = manual.indexOf('=')
  const id = separator < 0 ? manual : manual.slice(0, separator)
  const status = separator < 0 ? '' : manual.slice(separator + 1)
  if (status !== 'approved' && status !== 'rejected') {
    console.error(`Veredicto inválido "${status}": usa --set <productId>=approved|rejected`)
    process.exit(1)
  }
  const matches = products.filter((p) => p.id === id || p.id.startsWith(id))
  if (matches.length !== 1) {
    console.error(
      matches.length === 0
        ? `Producto no encontrado: ${id}`
        : `Prefijo ambiguo "${id}": coincide con ${matches.map((p) => p.id).join(', ')}`,
    )
    process.exit(1)
  }
  const product = matches[0]!
  product.quality = { status, reason: args.get('reason') ?? 'veredicto manual', judge: 'manual' }
  await store.saveProducts(siteId, products)
  console.log(`[${status}] ${product.id}`)
  process.exit(0)
}

const judge = judgeFromEnv()
// Solo modelos sin veredicto (idempotente y sin re-pagar VLM); --all re-juzga.
const rejudge = process.argv.includes('--all')
const targets = products.filter((p) => p.modelPath && (rejudge || !p.quality))
console.log(`Juzgando ${targets.length} modelos con ${judge.name}…`)
let failures = 0
for (const product of targets) {
  try {
    product.quality = await judge.judge({
      product,
      packshotPath: product.generationImagePath
        ? store.absolute(product.generationImagePath)
        : undefined,
      previewPath: product.previewPath ? store.absolute(product.previewPath) : undefined,
      modelPath: store.absolute(product.modelPath!),
    })
    // Checkpoint tras cada veredicto: un fallo a mitad no pierde los previos.
    await store.saveProducts(siteId, products)
    console.log(`[${product.quality.status}] ${product.id.slice(0, 55)} · ${product.quality.reason ?? ''}`)
  } catch (error) {
    failures++
    console.warn(`[judge-err] ${product.id.slice(0, 55)}: ${String(error)}`)
  }
}
if (failures > 0) console.warn(`${failures} productos sin veredicto por errores; re-ejecuta para reintentarlos`)
process.exit(failures > 0 ? 1 : 0)
