import type { Embedder, SearchProduct } from '../core/types'

/**
 * Embedder determinista sin red: hashing de rasgos (palabras + trigramas de
 * caracteres) sobre nombre, descripción y tramo de precio. Sirve para
 * desarrollo local, tests y como degradado si no hay proveedor configurado:
 * la similitud que captura es léxica, no semántica profunda, pero misma
 * entrada → mismo vector siempre (clave para la idempotencia del sync).
 *
 * v2: 1024 dims (con 256, las colisiones de hash dominaban el coseno de las
 * queries cortas: "bed" devolvía sartenes) y el NOMBRE pesa ×3 sobre la
 * descripción — es donde vive la identidad del producto; una descripción
 * larga ya no lo diluye.
 * v3: mezcla avalanche sobre FNV antes del módulo. FNV-1a dispersa mal los
 * bits bajos en strings cortos y el módulo potencia-de-2 solo mira esos
 * bits: "bed" y "pan" caían en el MISMO bucket (y "#bed" en el de "#pan").
 */
export class HashingEmbedder implements Embedder {
  readonly version = 'hashing-v3'
  readonly dim: number

  constructor(dim = 1024) {
    this.dim = dim
  }

  private static readonly NAME_WEIGHT = 3

  embedProducts(products: readonly SearchProduct[]): Promise<Float32Array[]> {
    return Promise.resolve(
      products.map((product) => {
        const vector = new Float32Array(this.dim)
        this.addText(vector, product.name, HashingEmbedder.NAME_WEIGHT)
        this.addText(vector, `${product.description} ${priceBucket(product.price)}`, 1)
        return vector
      }),
    )
  }

  embedQuery(query: string): Promise<Float32Array> {
    const vector = new Float32Array(this.dim)
    this.addText(vector, query, 1)
    return Promise.resolve(vector)
  }

  private addText(vector: Float32Array, text: string, weight: number): void {
    for (const token of tokensOf(text)) {
      const bucket = mixedHash(token) % this.dim
      const sign = mixedHash(`s${token}`) % 2 === 0 ? 1 : -1
      vector[bucket] = (vector[bucket] ?? 0) + sign * weight
    }
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

/** FNV + finalizador avalanche de Murmur3: reparte la entropía a TODOS los bits. */
function mixedHash(text: string): number {
  let h = fnv1a(text)
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}
