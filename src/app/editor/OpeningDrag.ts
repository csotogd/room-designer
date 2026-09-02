import type { Point2D } from '../../core/geometry/Point2D'
import type { Opening } from '../../core/model/Opening'
import type { Project } from '../../core/model/Project'
import type { Wall } from '../../core/model/Wall'

/**
 * Arrastre de puertas/ventanas por su pared en la escena 3D:
 * el punto del puntero se proyecta sobre la pared y se acota a sus límites.
 */
export function slideOffset(wall: Wall, opening: Opening, worldPoint: Point2D): number {
  const along = wall.segment().projectDistance(worldPoint)
  const max = Math.max(wall.length() - opening.width, 0)
  return Math.min(Math.max(along - opening.width / 2, 0), max)
}

export function canDropOpening(wall: Wall, opening: Opening, offset: number): boolean {
  return wall.canPlaceOpening(opening, offset)
}

/** Suelta la apertura en `offset` si es válido; si no, la deja donde estaba. */
export function tryDropOpening(
  project: Project,
  wall: Wall,
  opening: Opening,
  offset: number,
): boolean {
  if (!wall.canPlaceOpening(opening, offset)) return false
  project.moveOpening(wall, opening, offset)
  return true
}
