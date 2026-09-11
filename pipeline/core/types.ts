/**
 * Tipos y puertos del pipeline de catálogo (lado Node, fuera del navegador).
 * La carpeta local de assets replica el layout del futuro bucket S3.
 */

export interface ScrapedProduct {
  /** Identificador estable dentro del sitio (slug derivado de la URL). */
  id: string
  site: string
  /** País del catálogo de origen (en cloud: colección catalog_{site}_{country}). */
  country?: string
  sourceUrl: string
  name: string
  /** Descripción editorial de la fuente (si la publica); alimenta el embedding. */
  description?: string
  imageUrl: string
  price?: number
  currency?: string
  /** Licencia del asset (p. ej. "CC0", "CC-BY 4.0"): obligatoria para atribuir. */
  license?: string
  /** Autor original del asset, para cumplir la atribución de CC-BY. */
  author?: string
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
  /**
   * Fuentes con modelo 3D nativo (Poly Haven, Sketchfab): de dónde descargarlo.
   * `glb` es un fichero único; `gltf-files` es un .gltf con bin/texturas al
   * lado (rutas relativas → URL), con `entry` apuntando al .gltf raíz.
   */
  modelSource?:
    | { kind: 'glb'; url: string }
    | { kind: 'gltf-files'; entry: string; files: Record<string, string> }
  /** Huella del modelo publicada por la fuente: si cambia, se re-descarga. */
  modelSourceHash?: string
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
  /**
   * Tipo de fuente: 'jsonld' scrapea la web de una tienda; 'polyhaven' y
   * 'sketchfab' consumen la API oficial de una biblioteca de modelos 3D con
   * licencia abierta (el modelo llega hecho: sin generación ni juez).
   */
  kind?: 'jsonld' | 'polyhaven' | 'sketchfab'
  /** País del catálogo (ISO): en cloud, un catálogo por sitio × país. */
  country: string
  /** Solo para kind 'jsonld' (el scraper de tiendas los exige). */
  categoryUrls?: string[]
  /** Patrón de los href de página de producto dentro de una categoría. */
  productLinkPattern?: RegExp
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
  /**
   * Fichero suelto de un modelo multi-fichero (.gltf + .bin + texturas),
   * bajo models/<productId>/<relPath>. Devuelve la ruta relativa guardada.
   */
  saveModelPart(site: string, productId: string, relPath: string, bytes: Uint8Array): Promise<string>
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
 * Al re-ingestar, conserva modelo/preview/veredicto solo si la entrada de la
 * generación no cambió. Para modelos generados de foto, esa entrada es el
 * packshot; para fuentes con modelo nativo, la huella que publica la fuente
 * (files_hash de Poly Haven, updatedAt de Sketchfab): si cambia, caduca.
 */
export function carryOverGeneration(
  previous: ScrapedProduct | undefined,
  next: ScrapedProduct,
): void {
  if (!previous?.modelPath) return
  const sameSource = next.modelSource
    ? previous.modelSourceHash === next.modelSourceHash
    : previous.generationImageUrl === next.generationImageUrl
  if (sameSource) {
    next.modelPath = previous.modelPath
    next.previewPath = previous.previewPath
    next.quality = previous.quality
    // Las dimensiones medidas del GLB descargado también viajan con el modelo.
    if (next.modelSource) {
      next.widthCm ??= previous.widthCm
      next.depthCm ??= previous.depthCm
      next.heightCm ??= previous.heightCm
    }
  }
}
