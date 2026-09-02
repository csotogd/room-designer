import { Door } from '../../core/model/Door'
import { Window } from '../../core/model/Window'
import type { FloorPlan } from '../../core/model/FloorPlan'
import type { Opening } from '../../core/model/Opening'

/**
 * Paso "puertas y ventanas" del asistente de creación: añade una apertura a
 * una pared del plano en la distancia indicada (centrada en ella), acotada a
 * los límites de la pared. Devuelve null si no cabe (p. ej. solapa con otra).
 */
export function addWizardOpening(
  plan: FloorPlan,
  wallIndex: number,
  kind: 'door' | 'window',
  alongMeters: number,
): Opening | null {
  const wall = plan.walls[wallIndex]
  if (!wall) return null
  const opening = kind === 'door' ? new Door(0, 0.9) : new Window(0, 1.2)
  const max = Math.max(wall.length() - opening.width, 0)
  opening.offset = Math.min(Math.max(alongMeters - opening.width / 2, 0), max)
  if (!wall.canPlaceOpening(opening, opening.offset)) return null
  wall.addOpening(opening)
  return opening
}
