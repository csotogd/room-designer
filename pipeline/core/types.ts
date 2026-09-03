/**
 * Tipos y puertos del pipeline de catálogo (lado Node, fuera del navegador).
 * La carpeta local de assets replica el layout del futuro bucket S3.
 */

export interface ScrapedProduct {
  /** Identificador estable dentro del sitio (slug derivado de la URL). */
  id: string
  site: string
  sourceUrl: string
  name: string
  imageUrl: string
  price?: number
  currency?: string
  /** Medidas en centímetros, como las publica el catálogo. */
  widthCm?: number
  depthCm?: number
  heightCm?: number
  /** Resto de propiedades dimensionales publicadas (altura asiento, peso…). */
  extraDims: Record<string, number>
  /** Resto de fotos del producto (galería), para elegir el packshot. */
  galleryUrls?: string[]
  /** Rutas relativas dentro del bucket, cuando ya se han materializado. */
  imagePath?: string
  /** Foto elegida como entrada de la generación 3D (packshot, producto solo). */
  generationImagePath?: string
  /** URL de origen de esa foto (para invalidar el modelo si cambia). */
  generationImageUrl?: string
  modelPath?: string
  /** Render de previsualización que devuelve el generador (si lo da). */
  previewPath?: string
  /** Veredicto del juez de calidad sobre el modelo generado. */
  quality?: QualityVerdict
}

export interface QualityVerdict {
  status: 'approved' | 'rejected' | 'pending'
  reason?: string
  judge?: string
}

/** Resultado de la generación: la malla y, si el proveedor lo da, un render. */
export interface GenerationResult {
  model: Uint8Array
  preview?: Uint8Array
}

/** Configuración por sitio para el scraper genérico basado en JSON-LD. */
export interface SiteConfig {
  id: string
  categoryUrls: string[]
  /** Patrón de los href de página de producto dentro de una categoría. */
  productLinkPattern: RegExp
  origin: string
}

export interface CatalogScraper {
  scrape(limit: number): Promise<ScrapedProduct[]>
}

/** Puerto de almacenamiento: hoy carpeta local, mañana S3 con el mismo layout. */
export interface AssetStore {
  saveProducts(site: string, products: ScrapedProduct[]): Promise<void>
  readProducts(site: string): Promise<ScrapedProduct[]>
  /** Devuelve la ruta relativa bajo la raíz del bucket. */
  saveImage(site: string, productId: string, bytes: Uint8Array): Promise<string>
  saveGenerationImage(site: string, productId: string, bytes: Uint8Array): Promise<string>
  saveModel(site: string, productId: string, bytes: Uint8Array): Promise<string>
  savePreview(site: string, productId: string, bytes: Uint8Array): Promise<string>
  absolute(relativePath: string): string
}

export interface ProductDimensions {
  widthCm?: number
  depthCm?: number
  heightCm?: number
}

/** Puerto de generación imagen → malla (GLB). */
export interface MeshGenerator {
  readonly name: string
  generate(imageAbsolutePath: string, dims: ProductDimensions): Promise<GenerationResult>
}

/** Puerto del juez de calidad: decide si un modelo generado entra al catálogo. */
export interface JudgeInput {
  product: ScrapedProduct
  /** Rutas absolutas a la foto de entrada y al render del modelo (si existe). */
  packshotPath?: string
  previewPath?: string
  modelPath: string
}

export interface QualityJudge {
  readonly name: string
  judge(input: JudgeInput): Promise<QualityVerdict>
}

/** Productos aún sin modelo 3D: la cola de trabajo de la generación. */
export function pendingProducts(products: readonly ScrapedProduct[]): ScrapedProduct[] {
  return products.filter((p) => !p.modelPath && p.imagePath)
}

/**
 * Al re-ingestar, conserva modelo/preview/veredicto solo si la foto de
 * generación no cambió; si el packshot elegido es otro, el modelo caduca.
 */
export function carryOverGeneration(
  previous: ScrapedProduct | undefined,
  next: ScrapedProduct,
): void {
  if (previous?.modelPath && previous.generationImageUrl === next.generationImageUrl) {
    next.modelPath = previous.modelPath
    next.previewPath = previous.previewPath
    next.quality = previous.quality
  }
}
