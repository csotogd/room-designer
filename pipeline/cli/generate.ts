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

console.log(`Generando ${queue.length} modelos con ${generator.name}…`)
let ok = 0
for (const product of queue) {
  const t0 = Date.now()
  try {
    const glb = await generator.generate(store.absolute(product.imagePath!), {
      widthCm: product.widthCm,
      depthCm: product.depthCm,
      heightCm: product.heightCm,
    })
    product.modelPath = await store.saveModel(siteId, product.id, glb)
    await store.saveProducts(siteId, products) // checkpoint incremental
    ok += 1
    console.log(
      `[ok] ${product.id.slice(0, 50).padEnd(50)} ${Math.round(glb.length / 1024)} KB en ${Math.round((Date.now() - t0) / 1000)}s`,
    )
  } catch (error) {
    console.warn(
      `[fallo] ${product.id.slice(0, 50)}: ${String(error).slice(0, 160)} (${Math.round((Date.now() - t0) / 1000)}s)`,
    )
  }
}
console.log(`\n${ok}/${queue.length} generados. Bucket: ${store.absolute(siteId)}`)
