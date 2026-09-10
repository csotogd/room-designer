import type { ScrapedProduct } from './types'

/** Entrada de catálogo lista para la app (mismo shape que ProductData del front). */
export interface AppCatalogEntry {
  id: string
  name: string
  description: string
  width: number
  depth: number
  height: number
  price: number
  isSurface: boolean
  color: string
  form: 'box'
  /** Sitio web de procedencia; el menú de muebles solo enseña productos con origen. */
  origin: string
  /** Licencia y autor del asset (CC-BY exige mostrar la atribución en la UI). */
  license?: string
  author?: string
  assets: { imageUrl?: string; packshotUrl?: string; modelUrl?: string }
}

const SURFACE_HINTS = /mesa|aparador|escritorio|consola|estanter|c[oó]moda|banco|mesita/i

/**
 * Convierte un producto del bucket (cm, rutas relativas) en una entrada de
 * catálogo de la app (metros, URLs bajo baseUrl). El GLB, si existe, sustituye
 * a la forma procedural; si no, la app enseña un placeholder con la foto.
 */
export function toAppCatalogEntry(
  product: ScrapedProduct,
  baseUrl: string,
): AppCatalogEntry | null {
  if (!product.widthCm || !product.heightCm || !product.imagePath) return null
  // Un modelo rechazado por el juez de calidad no entra en el catálogo.
  if (product.quality?.status === 'rejected') return null
  const url = (path: string) => `${baseUrl}/${path.split('/').map(encodeURIComponent).join('/')}`
  return {
    id: `${product.site}-${product.id}`,
    name: product.name,
    // La descripción editorial de la fuente (si existe) alimenta un embedding
    // mucho más rico que el nombre con medidas.
    description:
      product.description ??
      `${product.name} · ${product.widthCm}×${product.depthCm ?? '?'}×${product.heightCm} cm · ${product.sourceUrl}`,
    width: product.widthCm / 100,
    depth: (product.depthCm ?? product.widthCm) / 100,
    height: product.heightCm / 100,
    price: product.price ?? 0,
    isSurface: SURFACE_HINTS.test(product.name),
    color: '#b8ab9b',
    form: 'box',
    origin: product.site,
    ...(product.license ? { license: product.license } : {}),
    ...(product.author ? { author: product.author } : {}),
    assets: {
      imageUrl: url(product.imagePath),
      ...(product.generationImagePath ? { packshotUrl: url(product.generationImagePath) } : {}),
      ...(product.modelPath ? { modelUrl: url(product.modelPath) } : {}),
    },
  }
}
