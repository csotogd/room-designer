import type { SyncReport } from './types'

/**
 * Métricas en memoria del servicio, expuestas en GET /metrics como JSON.
 * Suficiente para dashboards y alertas ("¿cuándo fue el último sync?, ¿qué
 * latencia tiene el search?") sin arrastrar un cliente de Prometheus; si un
 * día hace falta formato Prometheus, esta clase es el único punto a tocar.
 */
function rate(part: number, total: number): number | null {
  return total === 0 ? null : round(part / total)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

export class Metrics {
  private readonly startedAt = Date.now()
  private readonly byRoute = new Map<string, { count: number; errors: number; totalMs: number; maxMs: number }>()
  private lastSync: { at: string; durationMs: number; report: SyncReport } | null = null
  private lastSyncError: { at: string; detail: string } | null = null
  private search = { count: 0, empty: 0, lowConfidence: 0, topScoreSum: 0 }

  /** Bajo este score de coseno el mejor resultado se considera dudoso. */
  static readonly LOW_CONFIDENCE = 0.25

  observeRequest(route: string, status: number, durationMs: number): void {
    const entry = this.byRoute.get(route) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 }
    entry.count++
    if (status >= 500) entry.errors++
    entry.totalMs += durationMs
    entry.maxMs = Math.max(entry.maxMs, durationMs)
    this.byRoute.set(route, entry)
  }

  /**
   * Señales de calidad online, sin necesidad de etiquetas: el score del mejor
   * resultado y la tasa de búsquedas vacías o de baja confianza. Si suben,
   * la gente busca cosas que el catálogo o el embedder no cubren — es la
   * alarma para revisar el golden set y ampliar catálogo o mejorar modelo.
   */
  observeSearchQuality(topScore: number | null): void {
    this.search.count++
    if (topScore === null) this.search.empty++
    else {
      this.search.topScoreSum += topScore
      if (topScore < Metrics.LOW_CONFIDENCE) this.search.lowConfidence++
    }
  }

  observeSync(report: SyncReport, durationMs: number): void {
    this.lastSync = { at: new Date().toISOString(), durationMs, report }
  }

  observeSyncError(detail: string): void {
    this.lastSyncError = { at: new Date().toISOString(), detail }
  }

  snapshot(): Record<string, unknown> {
    const routes: Record<string, unknown> = {}
    for (const [route, entry] of this.byRoute) {
      routes[route] = {
        count: entry.count,
        errors: entry.errors,
        avgMs: Math.round((entry.totalMs / entry.count) * 100) / 100,
        maxMs: Math.round(entry.maxMs * 100) / 100,
      }
    }
    const answered = this.search.count - this.search.empty
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      routes,
      searchQuality: {
        searches: this.search.count,
        emptyRate: rate(this.search.empty, this.search.count),
        lowConfidenceRate: rate(this.search.lowConfidence, this.search.count),
        avgTopScore: answered === 0 ? null : round(this.search.topScoreSum / answered),
        lowConfidenceThreshold: Metrics.LOW_CONFIDENCE,
      },
      lastSync: this.lastSync,
      lastSyncError: this.lastSyncError,
    }
  }
}
