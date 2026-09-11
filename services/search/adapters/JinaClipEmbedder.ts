import type { Embedder, SearchProduct } from '../core/types'

/**
 * Embedder multimodal para producción: jina-clip-v2 embebe texto e imagen en
 * el MISMO espacio vectorial. El vector de un producto es la media normalizada
 * del embedding de su foto y el de su texto (nombre + descripción + precio);
 * la consulta se embebe solo como texto y matchea contra ambos.
 *
 * Config: JINA_API_KEY (obligatoria para este proveedor).
 */
export class JinaClipEmbedder implements Embedder {
  readonly version = 'jina-clip-v2'
  readonly dim = 1024

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = 'https://api.jina.ai/v1/embeddings',
  ) {}

  async embedProducts(products: readonly SearchProduct[]): Promise<Float32Array[]> {
    const results: Float32Array[] = []
    // Lotes pequeños: cada producto puede aportar 2 entradas (texto + imagen).
    for (let i = 0; i < products.length; i += 16) {
      const batch = products.slice(i, i + 16)
      const input: ({ text: string } | { image: string })[] = []
      const spans: { text: number; image: number | null }[] = []
      for (const product of batch) {
        spans.push({
          text: input.length,
          image: product.imageUrl ? input.length + 1 : null,
        })
        input.push({ text: productText(product) })
        if (product.imageUrl) input.push({ image: product.imageUrl })
      }
      const vectors = await this.request(input)
      for (const span of spans) {
        const text = vectors[span.text]!
        results.push(span.image === null ? text : averaged(text, vectors[span.image]!))
      }
    }
    return results
  }

  async embedQuery(query: string): Promise<Float32Array> {
    const [vector] = await this.request([{ text: query }])
    return vector!
  }

  private async request(
    input: readonly ({ text: string } | { image: string })[],
  ): Promise<Float32Array[]> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: 'jina-clip-v2', dimensions: this.dim, input }),
    })
    if (!response.ok) {
      throw new Error(`Jina embeddings ${response.status}: ${await response.text()}`)
    }
    const payload = (await response.json()) as { data: { index: number; embedding: number[] }[] }
    const vectors = new Array<Float32Array>(input.length)
    for (const item of payload.data) {
      vectors[item.index] = Float32Array.from(item.embedding)
    }
    return vectors
  }
}

function productText(product: SearchProduct): string {
  return `${product.name}. ${product.description}. Precio: ${Math.round(product.price)} EUR`
}

function averaged(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) result[i] = (a[i]! + b[i]!) / 2
  return result
}
