import type { SearchHit } from './types'

/**
 * Evaluación offline de la calidad del buscador con métricas IR estándar,
 * contra un golden set de consultas etiquetadas (query → ids relevantes).
 * Corre igual con el embedder local que con el proveedor de producción:
 * sirve para comparar proveedores y para poner una puerta de calidad en CI.
 */

export interface GoldenCase {
  query: string
  /** Ids de los productos relevantes para la consulta (sin orden). */
  relevant: string[]
}

export interface QueryEvaluation {
  query: string
  /** Cuántos de los relevantes aparecen en el top-k, sobre el total esperado. */
  recallAtK: number
  /** 1/posición del primer relevante (0 si no aparece en el top-k). */
  reciprocalRank: number
  /** Ganancia descontada normalizada del top-k (relevancia binaria). */
  ndcgAtK: number
  top: SearchHit[]
}

export interface EvaluationReport {
  k: number
  perQuery: QueryEvaluation[]
  meanRecallAtK: number
  meanReciprocalRank: number
  meanNdcgAtK: number
}

export function evaluateHits(
  hits: readonly SearchHit[],
  relevant: readonly string[],
  k: number,
): Omit<QueryEvaluation, 'query' | 'top'> {
  const top = hits.slice(0, k)
  const relevantSet = new Set(relevant)

  let found = 0
  let reciprocalRank = 0
  let dcg = 0
  for (let i = 0; i < top.length; i++) {
    if (!relevantSet.has(top[i]!.id)) continue
    found++
    if (reciprocalRank === 0) reciprocalRank = 1 / (i + 1)
    dcg += 1 / Math.log2(i + 2)
  }
  let idealDcg = 0
  for (let i = 0; i < Math.min(relevant.length, k); i++) idealDcg += 1 / Math.log2(i + 2)

  return {
    recallAtK: relevant.length === 0 ? 1 : found / Math.min(relevant.length, k),
    reciprocalRank,
    ndcgAtK: idealDcg === 0 ? 1 : dcg / idealDcg,
  }
}

export async function evaluateSearch(
  search: (query: string, limit: number) => Promise<SearchHit[]>,
  cases: readonly GoldenCase[],
  k = 5,
): Promise<EvaluationReport> {
  const perQuery: QueryEvaluation[] = []
  for (const goldenCase of cases) {
    const top = await search(goldenCase.query, k)
    perQuery.push({
      query: goldenCase.query,
      top,
      ...evaluateHits(top, goldenCase.relevant, k),
    })
  }
  const mean = (select: (q: QueryEvaluation) => number): number =>
    perQuery.length === 0 ? 0 : perQuery.reduce((sum, q) => sum + select(q), 0) / perQuery.length
  return {
    k,
    perQuery,
    meanRecallAtK: mean((q) => q.recallAtK),
    meanReciprocalRank: mean((q) => q.reciprocalRank),
    meanNdcgAtK: mean((q) => q.ndcgAtK),
  }
}
