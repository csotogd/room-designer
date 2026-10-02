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
 * La huella debe quedar dentro del suelo sin atravesar ninguna pared, también
 * en plantas cóncavas. El pequeño margen permite pegar muebles a una pared.
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
  const corners = footprintCorners(item, x, z, rotationY).map((corner) =>
    new Point2D(
      corner.x + (x - corner.x) * EDGE_INSET,
      corner.y + (z - corner.y) * EDGE_INSET,
    ),
  )
  if (!corners.every(corner => polygon.contains(corner))) return false
  // Ejes separadores del rectángulo y del segmento: detectan incluso un
  // entrante estrecho que no contenga ninguna esquina del mueble.
  return plan.walls.every(wall => {
    const axes = [corners[1]!.sub(corners[0]!).perp(), corners[3]!.sub(corners[0]!).perp(),
      wall.end.sub(wall.start).perp()]
    return axes.some(axis => {
      const footprint = corners.map(corner => corner.dot(axis))
      const segment = [wall.start.dot(axis), wall.end.dot(axis)]
      return Math.max(...footprint) < Math.min(...segment) || Math.max(...segment) < Math.min(...footprint)
    })
  })
}
