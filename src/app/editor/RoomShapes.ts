import { Point2D } from '../../core/geometry/Point2D'
import { FloorPlan } from '../../core/model/FloorPlan'

export type RoomShape = 'rect' | 'l' | 'u' | 't' | 'bevel'

export interface RoomDimensions {
  shape: RoomShape
  width: number
  depth: number
  height: number
  cutWidth: number
  cutDepth: number
}

export function createRoomPlan(dimensions: RoomDimensions): FloorPlan {
  const { shape, width: w, depth: d, height: h, cutWidth: cw, cutDepth: cd } = dimensions
  for (const [value, min, max] of [[w, 1, 30], [d, 1, 30], [h, 2, 6]] as const) {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error('Medidas: ancho y fondo entre 1 y 30 m; altura entre 2 y 6 m.')
    }
  }
  if (shape === 'rect') return FloorPlan.rectangle(w, d, h)
  if (!Number.isFinite(cw) || !Number.isFinite(cd) || cw <= 0 || cd <= 0 || cw >= w || cd >= d) {
    throw new Error('El recorte debe ser positivo y menor que el ancho y el fondo de la habitación.')
  }
  if (shape === 'l') return FloorPlan.lShape(w, d, cw, cd, h)
  const left = (w - cw) / 2
  const right = (w + cw) / 2
  const corners: Record<'u' | 't' | 'bevel', [number, number][]> = {
    u: [[0, 0], [w, 0], [w, d], [right, d], [right, d - cd], [left, d - cd], [left, d], [0, d]],
    t: [[0, 0], [w, 0], [w, d - cd], [right, d - cd], [right, d], [left, d], [left, d - cd], [0, d - cd]],
    bevel: [[0, 0], [w, 0], [w, d - cd], [w - cw, d], [0, d]],
  }
  return FloorPlan.fromCorners(corners[shape].map(([x, y]) => new Point2D(x, y)), h)
}
