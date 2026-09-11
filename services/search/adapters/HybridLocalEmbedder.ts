import { HashingEmbedder } from './HashingEmbedder'
import { LocalClipEmbedder } from './LocalClipEmbedder'
import type { Embedder, SearchProduct } from '../core/types'

/**
 * Embedder local por defecto: HÍBRIDO léxico + CLIP multimodal en un único
 * vector por concatenación de bloques ponderados.
 *
 * Truco (medido, no teología): cada bloque va normalizado a unidad y escalado
 * por √w; como todos los productos y la consulta llevan ambos bloques, la
 * normalización global es constante y el coseno del vector concatenado es
 * exactamente la combinación convexa de los cosenos por bloque:
 *
 *   score = w_lex · cos_lex + w_clip · cos_clip(texto+foto)
 *
 * El bloque léxico aporta la precisión de matching por n-gramas (donde CLIP
 * ViT-B/32 flojea en texto-texto fino); el bloque CLIP aporta recall
 * semántico y visual del packshot. Los pesos se tunean contra el golden set
 * (SEARCH_HYBRID_LEX_WEIGHT, por defecto 0.6).
 */
export class HybridLocalEmbedder implements Embedder {
  private readonly lexical: Embedder
  private readonly clip: Embedder
  private readonly lexWeight: number

  constructor(
    lexWeight = Number(process.env.SEARCH_HYBRID_LEX_WEIGHT ?? 0.6),
    lexical: Embedder = new HashingEmbedder(),
    clip: Embedder = new LocalClipEmbedder(),
  ) {
    this.lexical = lexical
    this.clip = clip
    this.lexWeight = lexWeight
  }

  get dim(): number {
    return this.lexical.dim + this.clip.dim
  }

  get version(): string {
    return `hybrid-${this.lexical.version}+${this.clip.version}-lex${this.lexWeight}`
  }

  async embedProducts(products: readonly SearchProduct[]): Promise<Float32Array[]> {
    const [lex, clip] = await Promise.all([
      this.lexical.embedProducts(products),
      this.clip.embedProducts(products),
    ])
    return lex.map((vector, i) => this.concat(vector, clip[i]!))
  }

  async embedQuery(query: string): Promise<Float32Array> {
    const [lex, clip] = await Promise.all([
      this.lexical.embedQuery(query),
      this.clip.embedQuery(query),
    ])
    return this.concat(lex, clip)
  }

  private concat(lex: Float32Array, clip: Float32Array): Float32Array {
    const result = new Float32Array(this.dim)
    writeScaledUnit(result, 0, lex, Math.sqrt(this.lexWeight))
    writeScaledUnit(result, lex.length, clip, Math.sqrt(1 - this.lexWeight))
    return result
  }
}

/** Copia `vector` normalizado a unidad y escalado por `scale` en `target[offset..]`. */
function writeScaledUnit(
  target: Float32Array,
  offset: number,
  vector: Float32Array,
  scale: number,
): void {
  let norm = 0
  for (let i = 0; i < vector.length; i++) norm += vector[i]! * vector[i]!
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < vector.length; i++) target[offset + i] = (vector[i]! / norm) * scale
}
