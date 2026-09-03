import type { SearchHit } from './types'

/**
 * Índice vectorial en memoria: fuerza bruta sobre una única Float32Array
 * contigua (coseno = producto escalar de vectores normalizados). Con 100k
 * productos × 256 dims son ~25M multiplicaciones por consulta: unos pocos
 * milisegundos, sin dependencias ni estructuras aproximadas que mantener.
 */
export class VectorIndex {
  private ids: string[] = []
  private rowOf = new Map<string, number>()
  private matrix: Float32Array
  private count = 0

  constructor(readonly dim: number, initialCapacity = 1024) {
    this.matrix = new Float32Array(initialCapacity * dim)
  }

  get size(): number {
    return this.count
  }

  has(id: string): boolean {
    return this.rowOf.has(id)
  }

  /** Inserta o reemplaza el vector de un producto (se normaliza al entrar). */
  upsert(id: string, vector: Float32Array): void {
    if (vector.length !== this.dim) {
      throw new Error(`Vector de ${vector.length} dims en un índice de ${this.dim}`)
    }
    let row = this.rowOf.get(id)
    if (row === undefined) {
      if (this.count * this.dim === this.matrix.length) this.grow()
      row = this.count++
      this.ids[row] = id
      this.rowOf.set(id, row)
    }
    const offset = row * this.dim
    let norm = 0
    for (let i = 0; i < this.dim; i++) norm += vector[i]! * vector[i]!
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < this.dim; i++) this.matrix[offset + i] = vector[i]! / norm
  }

  /** Borra un producto moviendo la última fila a su hueco (O(dim)). */
  remove(id: string): void {
    const row = this.rowOf.get(id)
    if (row === undefined) return
    const last = this.count - 1
    if (row !== last) {
      this.matrix.copyWithin(row * this.dim, last * this.dim, (last + 1) * this.dim)
      const movedId = this.ids[last]!
      this.ids[row] = movedId
      this.rowOf.set(movedId, row)
    }
    this.ids.length = last
    this.rowOf.delete(id)
    this.count = last
  }

  /** Los `k` productos más cercanos por coseno, de mayor a menor score. */
  search(query: Float32Array, k: number): SearchHit[] {
    let norm = 0
    for (let i = 0; i < this.dim; i++) norm += query[i]! * query[i]!
    norm = Math.sqrt(norm) || 1

    const limit = Math.min(k, this.count)
    const hits: SearchHit[] = []
    let worst = -Infinity
    for (let row = 0; row < this.count; row++) {
      const offset = row * this.dim
      let dot = 0
      for (let i = 0; i < this.dim; i++) dot += this.matrix[offset + i]! * query[i]!
      const score = dot / norm
      if (hits.length < limit) {
        hits.push({ id: this.ids[row]!, score })
        if (hits.length === limit) {
          hits.sort((a, b) => b.score - a.score)
          worst = hits[hits.length - 1]!.score
        }
      } else if (score > worst) {
        hits[hits.length - 1] = { id: this.ids[row]!, score }
        hits.sort((a, b) => b.score - a.score)
        worst = hits[hits.length - 1]!.score
      }
    }
    if (hits.length < limit) hits.sort((a, b) => b.score - a.score)
    return hits
  }

  /** Vista de los vectores vivos (filas compactas), para persistir. */
  snapshotVectors(): { ids: string[]; vectors: Float32Array } {
    return {
      ids: [...this.ids],
      vectors: this.matrix.slice(0, this.count * this.dim),
    }
  }

  private grow(): void {
    const next = new Float32Array(this.matrix.length * 2)
    next.set(this.matrix)
    this.matrix = next
  }
}
