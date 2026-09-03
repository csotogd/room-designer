/**
 * Tipos y puertos del microservicio de búsqueda semántica del catálogo.
 * Un producto se indexa como UN vector (foto + descripción + precio); el
 * refresco diario del catálogo sincroniza altas, cambios y bajas de forma
 * idempotente (hash de contenido: re-ejecutar el sync no re-embebe nada).
 */

/** Lo que el catálogo publica de cada producto para indexarlo. */
export interface SearchProduct {
  id: string
  name: string
  description: string
  price: number
  imageUrl?: string
}

/**
 * Puerto de embeddings. `version` participa en el hash de contenido: cambiar
 * de proveedor o de dimensión invalida el índice y fuerza el re-embebido.
 */
export interface Embedder {
  readonly version: string
  readonly dim: number
  /** Un vector por producto, combinando foto + texto (nombre, descripción, precio). */
  embedProducts(products: readonly SearchProduct[]): Promise<Float32Array[]>
  /** Vector de una consulta de texto libre. */
  embedQuery(query: string): Promise<Float32Array>
}

/** Registro persistido por producto: id + hash de contenido (el vector va aparte). */
export interface IndexedRecord {
  id: string
  contentHash: string
}

/** Instantánea completa del índice, para persistencia atómica. */
export interface IndexSnapshot {
  embedderVersion: string
  dim: number
  records: IndexedRecord[]
  /** Vectores en el mismo orden que `records`, concatenados (records.length × dim). */
  vectors: Float32Array
}

/** Puerto de persistencia de la instantánea (carpeta local hoy, bucket mañana). */
export interface SnapshotStore {
  load(): Promise<IndexSnapshot | null>
  save(snapshot: IndexSnapshot): Promise<void>
}

/** Resultado de un sync: qué pasó con cada clase de producto. */
export interface SyncReport {
  added: number
  updated: number
  removed: number
  unchanged: number
  total: number
}

export interface SearchHit {
  id: string
  score: number
}
