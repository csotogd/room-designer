import type { AppCatalogEntry } from './appCatalog'

/** Lo que el servicio de búsqueda indexa de cada entrada publicada. */
export interface SearchSyncProduct {
  id: string
  name: string
  description: string
  price: number
  imageUrl?: string
}

/**
 * Proyección de las entradas publicadas a productos indexables. La foto del
 * embedding es el PACKSHOT (producto solo sobre fondo neutro, el mismo que
 * alimenta la generación 3D): una foto lifestyle contaminaría el vector con
 * el ambiente (una silla negra en salón claro embebería "claro"). La foto de
 * catálogo queda solo como último recurso si un producto no tiene packshot.
 * Viaja como URL absoluta si hay base pública (en cloud, el CDN del bucket).
 */
export function toSearchProducts(
  entries: readonly AppCatalogEntry[],
  publicBaseUrl?: string,
): SearchSyncProduct[] {
  return entries.map((entry) => {
    const photo = entry.assets.packshotUrl ?? entry.assets.imageUrl
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      price: entry.price,
      ...(photo ? { imageUrl: publicBaseUrl ? publicBaseUrl + photo : photo } : {}),
    }
  })
}

export interface SearchSyncResult {
  ok: boolean
  detail: string
}

/**
 * Empuja la instantánea completa del catálogo al microservicio de búsqueda.
 * El endpoint es idempotente (hashes de contenido), así que repetir el link
 * no re-embebe nada; si el servicio no está levantado, el link no falla:
 * se avisa y el siguiente refresco lo dejará sincronizado.
 */
export async function syncSearchIndex(
  products: readonly SearchSyncProduct[],
  serviceUrl: string,
  token?: string,
  runId?: string,
): Promise<SearchSyncResult> {
  try {
    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // Trazabilidad extremo a extremo: los logs del servicio llevarán el
        // mismo id que esta ejecución del refresco de catálogo.
        ...(runId ? { 'X-Request-Id': runId } : {}),
      },
      body: JSON.stringify({ products }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status}: ${await response.text()}` }
    }
    const report = (await response.json()) as Record<string, number>
    return {
      ok: true,
      detail: `embeddings: +${report.added} ~${report.updated} -${report.removed} =${report.unchanged} (total ${report.total})`,
    }
  } catch (error) {
    return { ok: false, detail: String(error) }
  }
}
