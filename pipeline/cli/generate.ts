/**
 * Generación de modelos: recorre los productos sin GLB y los genera con el
 * generador elegido (Space gratuito de TRELLIS.2 o API de Tripo).
 *
 *   npm run pipeline:generate -- --site sklum --count 5
 *   GENERATOR=tripo TRIPO_API_KEY=... npm run pipeline:generate -- --site sklum
 */
import { LocalFolderAssetStore } from '../adapters/LocalFolderAssetStore'
import { TrellisSpaceMeshGenerator } from '../adapters/TrellisSpaceMeshGenerator'
import { TrellisV1SpaceMeshGenerator } from '../adapters/TrellisV1SpaceMeshGenerator'
import { TripoMeshGenerator } from '../adapters/TripoMeshGenerator'
import { judgeFromEnv } from '../adapters/judges'
import { pendingProducts, type MeshGenerator } from '../core/types'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')
}

const siteId = args.get('site') ?? 'sklum'
const count = Number(args.get('count') ?? Infinity)
const root = args.get('out') ?? 'data/catalog'

const generatorKind = process.env.GENERATOR ?? 'trellis'
const generator: MeshGenerator =
  generatorKind === 'tripo'
    ? new TripoMeshGenerator(process.env.TRIPO_API_KEY ?? '')
    : generatorKind === 'trellis1'
      ? new TrellisV1SpaceMeshGenerator(process.env.HF_TOKEN)
      : new TrellisSpaceMeshGenerator(process.env.HF_TOKEN)

const store = new LocalFolderAssetStore(root)
const products = await store.readProducts(siteId)
const queue = pendingProducts(products).slice(0, count)

const judge = judgeFromEnv()
console.log(`Generando ${queue.length} modelos con ${generator.name} (juez: ${judge.name})…`)
let ok = 0
for (const product of queue) {
  const t0 = Date.now()
  try {
    const result = await generator.generate(
      store.absolute(product.generationImagePath ?? product.imagePath!),
      {
        widthCm: product.widthCm,
        depthCm: product.depthCm,
        heightCm: product.heightCm,
      },
    )
    product.modelPath = await store.saveModel(siteId, product.id, result.model)
    if (result.preview) {
      product.previewPath = await store.savePreview(siteId, product.id, result.preview)
    }
    product.quality = await judge.judge({
      product,
      packshotPath: product.generationImagePath
        ? store.absolute(product.generationImagePath)
        : undefined,
      previewPath: product.previewPath ? store.absolute(product.previewPath) : undefined,
      modelPath: store.absolute(product.modelPath),
    })
    await store.saveProducts(siteId, products) // checkpoint incremental
    ok += 1
    console.log(
      `[ok] ${product.id.slice(0, 50).padEnd(50)} ${Math.round(result.model.length / 1024)} KB en ${Math.round((Date.now() - t0) / 1000)}s · juez: ${product.quality.status}`,
    )
  } catch (error) {
    console.warn(
      `[fallo] ${product.id.slice(0, 50)}: ${String(error).slice(0, 160)} (${Math.round((Date.now() - t0) / 1000)}s)`,
    )
  }
}
console.log(`\n${ok}/${queue.length} generados. Bucket: ${store.absolute(siteId)}`)
// Los clientes de gradio dejan conexiones abiertas que impedirían salir.
process.exit(ok === queue.length ? 0 : 1)
