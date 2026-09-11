import type { CandidateProduct, CatalogSource } from './types'

/**
 * Cliente del microservicio de búsqueda (lado servidor): resuelve la query
 * que eligió el LLM a top-k productos reales, hidratados con medidas, foto,
 * precio y descripción desde el catálogo publicado — el menú del picker VLM.
 */
export class DesignerSearchClient {
  constructor(
    private readonly baseUrl: string = process.env.SEARCH_URL ?? 'http://localhost:8787',
    private readonly catalog: CatalogSource | null = null,
  ) {}

  async topCandidates(query: string, k = 20): Promise<CandidateProduct[]> {
    const response = await fetch(
      `${this.baseUrl}/search?q=${encodeURIComponent(query)}&limit=${k}`,
      { signal: AbortSignal.timeout(5000) },
    )
    if (!response.ok) {
      throw new Error(`buscador HTTP ${response.status}: ${await response.text()}`)
    }
    const payload = (await response.json()) as { results: { id: string; score: number }[] }
    const candidates: CandidateProduct[] = []
    for (const hit of payload.results) {
      const product = this.catalog?.get(hit.id)
      if (!product) continue // el índice y el catálogo publicado deberían ir en sync
      candidates.push({ ...product, score: hit.score })
    }
    return candidates
  }
}
