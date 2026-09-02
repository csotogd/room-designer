import { Point2D } from '../../core/geometry/Point2D'
import type { Furniture } from '../../core/model/Furniture'
import type { Project } from '../../core/model/Project'
import { fitsInRoom } from './RoomBounds'

/**
 * Superficie más alta bajo un punto del plano, excluyendo el mueble arrastrado
 * y todo lo que descansa sobre él (no puedes soltar la mesa sobre su jarrón).
 */
export function surfaceAt(
  project: Project,
  x: number,
  z: number,
  dragged?: Furniture,
): Furniture | null {
  const point = new Point2D(x, z)
  const excluded = dragged ? new Set([dragged, ...project.dependentsOf(dragged)]) : new Set()
  const candidates = project.furniture.filter(
    (f) => !excluded.has(f) && f.item.isSurface && f.containsPlanPoint(point),
  )
  if (candidates.length === 0) return null
  return candidates.reduce((top, f) => (f.topY() > top.topY() ? f : top))
}

/**
 * Regla única de "soltar un mueble" (compartida por las vistas 2D y 3D):
 * fuera de la habitación no se suelta (se queda donde estaba); sobre una
 * superficie se apoya conservando el punto; sobre suelo libre se libera de
 * su soporte y queda en el suelo.
 */
export function dropFurniture(project: Project, furniture: Furniture, x: number, z: number): void {
  if (!fitsInRoom(project.floorPlan, furniture.item, x, z, furniture.rotationY)) return
  const support = surfaceAt(project, x, z, furniture)
  if (support && support !== furniture.supportedBy) {
    project.support(furniture, support, x, z)
    return
  }
  if (!support && furniture.supportedBy) {
    project.clearSupport(furniture)
  }
  project.moveFurniture(furniture, x, z)
}
