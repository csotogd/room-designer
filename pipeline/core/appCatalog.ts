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
  assets: { imageUrl?: string; modelUrl?: string }
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
  const url = (path: string) => `${baseUrl}/${path.split('/').map(encodeURIComponent).join('/')}`
  return {
    id: `${product.site}-${product.id}`,
    name: product.name,
    description: `${product.name} · ${product.widthCm}×${product.depthCm ?? '?'}×${product.heightCm} cm · ${product.sourceUrl}`,
    width: product.widthCm / 100,
    depth: (product.depthCm ?? product.widthCm) / 100,
    height: product.heightCm / 100,
    price: product.price ?? 0,
    isSurface: SURFACE_HINTS.test(product.name),
    color: '#b8ab9b',
    form: 'box',
    assets: {
      imageUrl: url(product.imagePath),
      ...(product.modelPath ? { modelUrl: url(product.modelPath) } : {}),
    },
  }
}
