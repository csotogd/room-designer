import { Point2D } from '../geometry/Point2D'
import { Polygon } from '../geometry/Polygon'
import { Wall } from './Wall'
import type { Opening } from './Opening'

const CORNER_EPS = 1e-4

/** El plano: colección de paredes de la que se deriva el suelo. */
export class FloorPlan {
  private readonly _walls: Wall[] = []

  static rectangle(width: number, depth: number, height = 2.5): FloorPlan {
    return FloorPlan.fromCorners(
      [
        new Point2D(0, 0),
        new Point2D(width, 0),
        new Point2D(width, depth),
        new Point2D(0, depth),
      ],
      height,
    )
  }

  /** Habitación en L: rectángulo width×depth con un recorte cutW×cutD en una esquina. */
  static lShape(width: number, depth: number, cutW: number, cutD: number, height = 2.5): FloorPlan {
    return FloorPlan.fromCorners(
      [
        new Point2D(0, 0),
        new Point2D(width, 0),
        new Point2D(width, depth - cutD),
        new Point2D(width - cutW, depth - cutD),
        new Point2D(width - cutW, depth),
        new Point2D(0, depth),
      ],
      height,
    )
  }

  static fromCorners(corners: readonly Point2D[], height = 2.5): FloorPlan {
    const plan = new FloorPlan()
    for (let i = 0; i < corners.length; i++) {
      const wall = new Wall(corners[i]!, corners[(i + 1) % corners.length]!)
      wall.height = height
      plan.addWall(wall)
    }
    return plan
  }

  get walls(): readonly Wall[] {
    return this._walls
  }

  addWall(wall: Wall): void {
    this._walls.push(wall)
  }

  removeWall(wall: Wall): void {
    const index = this._walls.indexOf(wall)
    if (index >= 0) this._walls.splice(index, 1)
  }

  openings(): Opening[] {
    return this._walls.flatMap((w) => [...w.openings])
  }

  /** Ensaya la geometría sin cambiar las paredes ni sus aperturas originales. */
  withWallGeometry(wall: Wall, start: Point2D, end: Point2D): FloorPlan {
    if (!this._walls.includes(wall)) throw new Error('La pared no pertenece a este plano')
    const replace = (point: Point2D) => point.equals(wall.start) ? start : point.equals(wall.end) ? end : point
    const candidate = new FloorPlan()
    for (const original of this._walls) {
      const next = new Wall(replace(original.start), replace(original.end), original.thickness, original.height, original.id)
      if (![next.start.x, next.start.y, next.end.x, next.end.y].every(Number.isFinite) || next.length() < 0.3) {
        throw new Error('La pared debe medir al menos 30 cm y tener coordenadas finitas')
      }
      for (const opening of original.openings) next.addOpening(opening)
      candidate.addWall(next)
    }
    const polygon = candidate.floorPolygon()
    const originalPolygon = this.floorPolygon()
    if (!polygon || !originalPolygon || winding(polygon) * winding(originalPolygon) <= 0) {
      throw new Error('La habitación debe conservar un contorno cerrado sin invertir sus paredes')
    }
    for (const axis of ['x', 'y'] as const) {
      const values = polygon.vertices.map(p => p[axis])
      if (Math.max(...values) - Math.min(...values) > 30) throw new Error('La habitación no puede superar 30 m')
    }
    for (let i = 0; i < candidate.walls.length; i++) {
      const a = candidate.walls[i]!
      for (const b of candidate.walls.slice(i + 1)) {
        if ([a.start, a.end].some(p => p.equals(b.start) || p.equals(b.end))) continue
        if (a.segment().intersects(b.segment())) throw new Error('Las paredes no pueden cruzarse')
      }
    }
    return candidate
  }

  reshapeWall(wall: Wall, start: Point2D, end: Point2D): void {
    const candidate = this.withWallGeometry(wall, start, end)
    this._walls.forEach((original, index) => {
      const next = candidate.walls[index]!
      original.moveTo(next.start, next.end)
    })
  }

  /** Pared más cercana a un punto dentro de una tolerancia, o null. */
  wallAt(point: Point2D, tolerance: number): Wall | null {
    let best: Wall | null = null
    let bestDistance = tolerance
    for (const wall of this._walls) {
      const distance = wall.segment().distanceToPoint(point)
      if (distance <= bestDistance) {
        best = wall
        bestDistance = distance
      }
    }
    return best
  }

  /**
   * Si las paredes forman un único bucle cerrado, devuelve el polígono del
   * suelo (las esquinas en orden); si no, null.
   */
  floorPolygon(): Polygon | null {
    if (this._walls.length < 3) return null
    const remaining = new Set(this._walls)
    const first = this._walls[0]!
    remaining.delete(first)
    const origin = first.start
    const corners: Point2D[] = [origin]
    let cursor = first.end

    while (!cursor.equals(origin, CORNER_EPS)) {
      const next = this.findWallFrom(cursor, remaining)
      if (!next) return null
      remaining.delete(next.wall)
      corners.push(cursor)
      cursor = next.exit
    }
    return remaining.size === 0 && corners.length >= 3 ? new Polygon(corners) : null
  }

  private findWallFrom(
    point: Point2D,
    candidates: ReadonlySet<Wall>,
  ): { wall: Wall; exit: Point2D } | null {
    for (const wall of candidates) {
      if (wall.start.equals(point, CORNER_EPS)) return { wall, exit: wall.end }
      if (wall.end.equals(point, CORNER_EPS)) return { wall, exit: wall.start }
    }
    return null
  }
}

function winding(polygon: Polygon): number {
  return polygon.vertices.reduce((area, point, i, points) => {
    const next = points[(i + 1) % points.length]!
    return area + point.x * next.y - next.x * point.y
  }, 0)
}
