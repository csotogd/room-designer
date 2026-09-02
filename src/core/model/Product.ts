/** Referencias a los assets del producto; en producción, URLs de un bucket (S3/CDN). */
export interface ProductAssets {
  /** Foto de producto para el catálogo. */
  readonly imageUrl?: string
  /** Modelo 3D (GLB/glTF) con texturas. */
  readonly modelUrl?: string
}

/** Formas 3D que el renderer sabe construir proceduralmente (fallback sin GLB). */
export const PRODUCT_FORMS = [
  'sofa',
  'table',
  'chair',
  'stool',
  'bench',
  'bed',
  'wardrobe',
  'shelf',
  'sideboard',
  'mirror',
  'pouf',
  'plant',
  'vase',
  'tv',
  'rug',
  'box',
] as const

export type ProductForm = (typeof PRODUCT_FORMS)[number]

export interface ProductData {
  id: string
  name: string
  description: string
  /** Dimensiones en metros. */
  width: number
  depth: number
  height: number
  /** Precio en euros. */
  price: number
  /** ¿Admite objetos apoyados encima? */
  isSurface: boolean
  /** Color base del renderizado procedural. */
  color: string
  /** Forma procedural; por defecto, el propio id si es una forma conocida. */
  form?: ProductForm
  assets?: ProductAssets
}

/**
 * Entidad de catálogo: un producto con identidad, precio, descripción y sus
 * assets (foto y modelo GLB). Si `modelUrl` está presente, el renderer carga
 * el GLB; si no, construye la forma procedural indicada por `form`.
 */
export class Product {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly width: number
  readonly depth: number
  readonly height: number
  readonly price: number
  readonly isSurface: boolean
  readonly color: string
  readonly form: ProductForm
  readonly assets: ProductAssets

  constructor(data: ProductData) {
    this.id = data.id
    this.name = data.name
    this.description = data.description
    this.width = data.width
    this.depth = data.depth
    this.height = data.height
    this.price = data.price
    this.isSurface = data.isSurface
    this.color = data.color
    this.form =
      data.form ?? (PRODUCT_FORMS.includes(data.id as ProductForm) ? (data.id as ProductForm) : 'box')
    this.assets = data.assets ?? {}
  }
}
