import { Point2D } from '../../core/geometry/Point2D'
import type { CatalogItem } from '../../core/model/CatalogItem'
import type { FloorPlan } from '../../core/model/FloorPlan'

/** Esquinas de la huella (rotada) de un artículo colocado en (x, z). */
export function footprintCorners(
  item: CatalogItem,
  x: number,
  z: number,
  rotationY: number,
): Point2D[] {
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const halfW = item.width / 2
  const halfD = item.depth / 2
  return [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([lx, lz]) => new Point2D(x + lx! * cos - lz! * sin, z + lx! * sin + lz! * cos))
}

const EDGE_INSET = 1e-4

/**
 * ¿Cabe el artículo entero dentro de la habitación? Las cuatro esquinas de su
 * huella deben caer dentro del polígono del suelo (con una tolerancia mínima
 * para poder pegarlo a la pared). Sin habitación cerrada no hay restricción.
 */
export function fitsInRoom(
  plan: FloorPlan,
  item: CatalogItem,
  x: number,
  z: number,
  rotationY: number,
): boolean {
  const polygon = plan.floorPolygon()
  if (!polygon) return true
  return footprintCorners(item, x, z, rotationY).every((corner) => {
    const inset = new Point2D(
      corner.x + (x - corner.x) * EDGE_INSET,
      corner.y + (z - corner.y) * EDGE_INSET,
    )
    return polygon.contains(inset)
  })
}
