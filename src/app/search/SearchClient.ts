import type { CatalogItem } from '../../core/model/CatalogItem'

/**
 * Cliente del microservicio de búsqueda. Si el servicio no responde (no
 * levantado en local, red caída), la barra sigue funcionando con un ranking
 * léxico local: nunca deja el catálogo sin buscar.
 */
export class SearchClient {
  constructor(
    private readonly baseUrl: string = (import.meta.env?.VITE_SEARCH_URL as string | undefined) ??
      'http://localhost:8787',
  ) {}

  /** Scores por id de producto, o null si el servicio no está disponible. */
  async rank(query: string, limit = 60): Promise<Map<string, number> | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        { signal: AbortSignal.timeout(2500) },
      )
      if (!response.ok) return null
      const payload = (await response.json()) as { results: { id: string; score: number }[] }
      return new Map(payload.results.map((r) => [r.id, r.score]))
    } catch {
      return null
    }
  }
}

/**
 * Degradado local: puntuación léxica sobre nombre + descripción + precio.
 * Mismo contrato que el servicio (mapa id → score, mayor = más relevante).
 */
export function rankLocally(
  query: string,
  products: readonly CatalogItem[],
): Map<string, number> {
  const terms = normalize(query).split(/\s+/).filter((t) => t.length > 1)
  const scores = new Map<string, number>()
  if (terms.length === 0) return scores
  for (const product of products) {
    const name = normalize(product.name)
    const description = normalize(product.description)
    let score = 0
    for (const term of terms) {
      if (name.includes(term)) score += 3
      else if (description.includes(term)) score += 1
    }
    if (score > 0) scores.set(product.id, score)
  }
  return scores
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}
