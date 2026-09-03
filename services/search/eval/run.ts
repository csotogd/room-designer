/**
 * Evaluación offline de la calidad del buscador contra el golden set.
 *
 *   npm run search:eval
 *
 * Indexa el catálogo publicado (public/catalog/index.json) con el embedder
 * configurado (EMBEDDINGS_PROVIDER, como el servicio) y mide Recall@5, MRR y
 * NDCG@5 por consulta. Sale con código 1 si la media queda por debajo de la
 * puerta de calidad: sirve de gate en CI y para comparar proveedores de
 * embeddings con números en la mano antes de cambiarlos en producción.
 *
 *   SEARCH_EVAL_MIN_MRR   (0.6) puerta mínima de MRR medio
 *   SEARCH_EVAL_K         (5)   profundidad del corte
 */
import { readFile } from 'node:fs/promises'
import { HashingEmbedder } from '../adapters/HashingEmbedder'
import { JinaClipEmbedder } from '../adapters/JinaClipEmbedder'
import { evaluateSearch, type GoldenCase } from '../core/evaluation'
import { SearchIndexService } from '../core/SearchIndexService'
import type { Embedder } from '../core/types'

const catalogPath = process.argv[2] ?? 'public/catalog/index.json'
const goldenPath = process.argv[3] ?? 'services/search/eval/golden.json'
const k = Number(process.env.SEARCH_EVAL_K ?? 5)
const minMrr = Number(process.env.SEARCH_EVAL_MIN_MRR ?? 0.6)

const embedder: Embedder =
  process.env.EMBEDDINGS_PROVIDER === 'jina'
    ? new JinaClipEmbedder(process.env.JINA_API_KEY ?? '')
    : new HashingEmbedder()

const entries = JSON.parse(await readFile(catalogPath, 'utf8')) as {
  id: string
  name: string
  description: string
  price: number
  assets: { imageUrl?: string }
}[]
const { cases } = JSON.parse(await readFile(goldenPath, 'utf8')) as { cases: GoldenCase[] }

const known = new Set(entries.map((e) => e.id))
for (const goldenCase of cases) {
  for (const id of goldenCase.relevant) {
    if (!known.has(id)) {
      console.warn(`⚠ golden set desactualizado: "${id}" ya no está en el catálogo`)
    }
  }
}

const service = new SearchIndexService(embedder)
await service.sync(
  entries.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    price: e.price,
    imageUrl: e.assets.imageUrl,
  })),
)

const report = await evaluateSearch((q, limit) => service.search(q, limit), cases, k)

console.log(`\nCalidad del buscador · ${embedder.version} · ${entries.length} productos · k=${k}\n`)
for (const q of report.perQuery) {
  const flag = q.reciprocalRank < 1 ? (q.reciprocalRank === 0 ? '✗' : '~') : '✓'
  console.log(
    `${flag} recall@${k}=${q.recallAtK.toFixed(2)} mrr=${q.reciprocalRank.toFixed(2)} ndcg=${q.ndcgAtK.toFixed(2)}  «${q.query}»`,
  )
  if (q.reciprocalRank < 1) {
    console.log(`    top: ${q.top.slice(0, 3).map((h) => `${h.id} (${h.score.toFixed(2)})`).join(' · ')}`)
  }
}
console.log(
  `\nMedias: recall@${k}=${report.meanRecallAtK.toFixed(3)} · MRR=${report.meanReciprocalRank.toFixed(3)} · NDCG@${k}=${report.meanNdcgAtK.toFixed(3)}`,
)

if (report.meanReciprocalRank < minMrr) {
  console.error(`\n✗ MRR medio ${report.meanReciprocalRank.toFixed(3)} < puerta ${minMrr}`)
  process.exit(1)
}
console.log(`\n✓ Puerta de calidad superada (MRR ≥ ${minMrr})`)
