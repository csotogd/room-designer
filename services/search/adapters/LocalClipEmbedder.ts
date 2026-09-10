import { join } from 'node:path'
import type { Embedder, SearchProduct } from '../core/types'

/**
 * Embedder multimodal LOCAL: CLIP real (ViT-B/32) vía transformers.js sobre
 * ONNX Runtime — sin API key ni red en inferencia (el modelo, ~90 MB
 * cuantizado, se descarga de Hugging Face la primera vez y queda cacheado).
 *
 * Mismo esquema que el proveedor de producción (jina-clip): texto e imagen
 * comparten espacio latente; el vector de un producto es la media de ambos
 * embeddings normalizados, y la consulta se embebe solo como texto contra esa
 * fusión — así "silla negra" matchea por lo que se VE en el packshot aunque
 * la descripción no diga "negra".
 *
 * Config: SEARCH_CLIP_MODEL (Xenova/clip-vit-base-patch32),
 *         CATALOG_PUBLIC_DIR (public) — raíz de las fotos con URL relativa.
 */
export class LocalClipEmbedder implements Embedder {
  readonly dim = 512

  private backend: Promise<ClipBackend> | null = null

  constructor(
    private readonly model = process.env.SEARCH_CLIP_MODEL ?? 'Xenova/clip-vit-base-patch32',
    private readonly publicDir = process.env.CATALOG_PUBLIC_DIR ?? 'public',
    /**
     * Peso de la foto en la fusión (0..1). Medido contra el golden set: con
     * 0.5 la torre de imagen domina y aparecen "hubs" (imágenes cercanas a
     * todo, banda de scores plana) que hunden recall; la consulta es texto,
     * así que el texto manda y la foto aporta señal visual complementaria.
     */
    private readonly imageWeight = Number(process.env.SEARCH_CLIP_IMAGE_WEIGHT ?? 0.25),
  ) {}

  get version(): string {
    return `clip-local-${this.model.split('/').pop()}-w${this.imageWeight}`
  }

  async embedProducts(products: readonly SearchProduct[]): Promise<Float32Array[]> {
    const backend = await this.load()
    const results: Float32Array[] = []
    for (const product of products) {
      const text = await backend.embedText(productText(product))
      const image = product.imageUrl ? await this.tryEmbedImage(backend, product.imageUrl) : null
      results.push(image ? weightedUnit(text, image, this.imageWeight) : unit(text))
    }
    return results
  }

  async embedQuery(query: string): Promise<Float32Array> {
    const backend = await this.load()
    // Plantilla zero-shot clásica de CLIP: sin ella, una palabra suelta
    // ("bed") cae en la zona degenerada del encoder y devuelve ruido.
    return unit(await backend.embedText(`a photo of ${query}, furniture product`))
  }

  /** Foto ilegible ≠ producto sin indexar: se degrada a solo-texto con aviso. */
  private async tryEmbedImage(backend: ClipBackend, url: string): Promise<Float32Array | null> {
    try {
      // Las URLs relativas del catálogo local ("/catalog/...") viven en public/.
      const source = /^https?:\/\//.test(url) ? url : join(this.publicDir, url.replace(/^\//, ''))
      return await backend.embedImage(source)
    } catch (error) {
      console.warn(`[clip-local] foto no embebible ${url}: ${String(error)}`)
      return null
    }
  }

  private load(): Promise<ClipBackend> {
    this.backend ??= createBackend(this.model)
    return this.backend
  }
}

interface ClipBackend {
  embedText(text: string): Promise<Float32Array>
  embedImage(source: string): Promise<Float32Array>
}

/** Carga perezosa y única de tokenizer + torres de texto y visión. */
async function createBackend(model: string): Promise<ClipBackend> {
  const {
    AutoTokenizer,
    AutoProcessor,
    CLIPTextModelWithProjection,
    CLIPVisionModelWithProjection,
    RawImage,
  } = await import('@huggingface/transformers')

  const [tokenizer, processor, textModel, visionModel] = await Promise.all([
    AutoTokenizer.from_pretrained(model),
    AutoProcessor.from_pretrained(model, {}),
    CLIPTextModelWithProjection.from_pretrained(model, { dtype: 'q8' }),
    CLIPVisionModelWithProjection.from_pretrained(model, { dtype: 'q8' }),
  ])

  return {
    async embedText(text: string): Promise<Float32Array> {
      // CLIP trunca a 77 tokens: el tokenizer lo aplica, aquí solo acotamos coste.
      const inputs = tokenizer(text.slice(0, 400), { padding: true, truncation: true })
      const output = (await textModel(inputs)) as { text_embeds: { data: Float32Array } }
      return Float32Array.from(output.text_embeds.data)
    },
    async embedImage(source: string): Promise<Float32Array> {
      const image = await RawImage.read(source)
      const inputs = await processor(image)
      const output = (await visionModel(inputs)) as { image_embeds: { data: Float32Array } }
      return Float32Array.from(output.image_embeds.data)
    },
  }
}

function productText(product: SearchProduct): string {
  return `${product.name}. ${product.description}. Precio: ${Math.round(product.price)} EUR`
}

function unit(vector: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < vector.length; i++) norm += vector[i]! * vector[i]!
  norm = Math.sqrt(norm) || 1
  const result = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) result[i] = vector[i]! / norm
  return result
}

/** Combinación convexa de vectores YA normalizados: (1-w)·texto + w·imagen. */
function weightedUnit(text: Float32Array, image: Float32Array, w: number): Float32Array {
  const ut = unit(text)
  const ui = unit(image)
  const mix = new Float32Array(ut.length)
  for (let i = 0; i < ut.length; i++) mix[i] = (1 - w) * ut[i]! + w * ui[i]!
  return mix
}
