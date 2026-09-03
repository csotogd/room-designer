import type { Embedder, SearchProduct } from '../core/types'

/**
 * Embedder determinista sin red: hashing de rasgos (palabras + trigramas de
 * caracteres) sobre nombre, descripción y tramo de precio. Sirve para
 * desarrollo local, tests y como degradado si no hay proveedor configurado:
 * la similitud que captura es léxica, no semántica profunda, pero misma
 * entrada → mismo vector siempre (clave para la idempotencia del sync).
 */
export class HashingEmbedder implements Embedder {
  readonly version = 'hashing-v1'
  readonly dim: number

  constructor(dim = 256) {
    this.dim = dim
  }

  embedProducts(products: readonly SearchProduct[]): Promise<Float32Array[]> {
    return Promise.resolve(
      products.map((product) =>
        this.embedText(
          `${product.name} ${product.description} ${priceBucket(product.price)}`,
        ),
      ),
    )
  }

  embedQuery(query: string): Promise<Float32Array> {
    return Promise.resolve(this.embedText(query))
  }

  private embedText(text: string): Float32Array {
    const vector = new Float32Array(this.dim)
    for (const token of tokensOf(text)) {
      const bucket = fnv1a(token) % this.dim
      const sign = fnv1a(`s${token}`) % 2 === 0 ? 1 : -1
      vector[bucket] = (vector[bucket] ?? 0) + sign
    }
    return vector
  }
}

/** El precio entra al embedding como tramo, no como número exacto. */
function priceBucket(price: number): string {
  if (price <= 0) return ''
  const bucket =
    price < 50 ? 'barato' : price < 150 ? 'medio' : price < 400 ? 'caro' : 'premium'
  return `precio ${bucket} ${Math.round(price / 50) * 50} eur`
}

function* tokensOf(text: string): Generator<string> {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  const words = normalized.match(/[a-z0-9]+/g) ?? []
  for (const word of words) {
    yield word
    for (let i = 0; i + 3 <= word.length; i++) yield `#${word.slice(i, i + 3)}`
  }
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}
