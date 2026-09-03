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
  const [id, status] = manual.split('=') as [string, 'approved' | 'rejected']
  const product = products.find((p) => p.id === id || p.id.startsWith(id))
  if (!product) {
    console.error(`Producto no encontrado: ${id}`)
    process.exit(1)
  }
  product.quality = { status, reason: args.get('reason') ?? 'veredicto manual', judge: 'manual' }
  await store.saveProducts(siteId, products)
  console.log(`[${status}] ${product.id}`)
  process.exit(0)
}

const judge = judgeFromEnv()
const targets = products.filter((p) => p.modelPath)
console.log(`Juzgando ${targets.length} modelos con ${judge.name}…`)
for (const product of targets) {
  product.quality = await judge.judge({
    product,
    packshotPath: product.generationImagePath
      ? store.absolute(product.generationImagePath)
      : undefined,
    previewPath: product.previewPath ? store.absolute(product.previewPath) : undefined,
    modelPath: store.absolute(product.modelPath!),
  })
  console.log(`[${product.quality.status}] ${product.id.slice(0, 55)} · ${product.quality.reason ?? ''}`)
}
await store.saveProducts(siteId, products)
process.exit(0)
