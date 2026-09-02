/**
 * Descripción de un producto del catálogo. `isSurface` indica si admite
 * objetos apoyados encima (mesa sí, alfombra no).
 */
export interface CatalogItem {
  readonly id: string
  readonly name: string
  /** Dimensiones en metros. */
  readonly width: number
  readonly depth: number
  readonly height: number
  readonly isSurface: boolean
  /** Color base para el renderizado. */
  readonly color: string
  /** Precio en euros para el carrito. */
  readonly price: number
}
