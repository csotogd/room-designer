import { Point2D } from '../geometry/Point2D'
import { Point3D } from '../geometry/Point3D'
import { newId } from '../util/id'
import type { CatalogItem } from './CatalogItem'

/**
 * Mueble colocado: posición 3D (x,z en planta, y = elevación), rotación sobre
 * el eje vertical y, opcionalmente, el mueble que lo soporta.
 */
export class Furniture {
  readonly id: string
  position: Point3D
  rotationY: number
  supportedBy?: Furniture

  constructor(
    readonly item: CatalogItem,
    position: Point3D,
    rotationY = 0,
    supportedBy?: Furniture,
    id?: string,
  ) {
    this.position = position
    this.rotationY = rotationY
    this.supportedBy = supportedBy
    this.id = id ?? newId('furniture')
  }

  rotationYDegrees(): number {
    return (this.rotationY * 180) / Math.PI
  }

  /** Cadena de soportes hacia abajo (mesa, aparador…), sin incluirse a sí mismo. */
  supportChain(): Furniture[] {
    const chain: Furniture[] = []
    let cursor = this.supportedBy
    while (cursor) {
      chain.push(cursor)
      cursor = cursor.supportedBy
    }
    return chain
  }

  /** Altura de la cara superior: donde se apoyaría otro objeto. */
  topY(): number {
    return this.position.y + this.item.height
  }

  /** ¿Cae este punto del plano dentro de la huella (rotada) del mueble? */
  containsPlanPoint(point: Point2D): boolean {
    const dx = point.x - this.position.x
    const dz = point.y - this.position.z
    const cos = Math.cos(-this.rotationY)
    const sin = Math.sin(-this.rotationY)
    const localX = dx * cos - dz * sin
    const localZ = dx * sin + dz * cos
    return Math.abs(localX) <= this.item.width / 2 && Math.abs(localZ) <= this.item.depth / 2
  }
}
