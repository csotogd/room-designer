import { Point2D } from './Point2D'

/** Polígono simple definido por sus vértices ordenados. */
export class Polygon {
  constructor(readonly vertices: readonly Point2D[]) {
    if (vertices.length < 3) throw new Error('Un polígono necesita al menos 3 vértices')
  }

  /** Área por fórmula del cordón (shoelace), siempre positiva. */
  area(): number {
    let sum = 0
    const v = this.vertices
    for (let i = 0; i < v.length; i++) {
      const a = v[i]!
      const b = v[(i + 1) % v.length]!
      sum += a.x * b.y - b.x * a.y
    }
    return Math.abs(sum) / 2
  }

  /** Test punto-en-polígono por ray casting. */
  contains(point: Point2D): boolean {
    let inside = false
    const v = this.vertices
    for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
      const a = v[i]!
      const b = v[j]!
      const intersects =
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      if (intersects) inside = !inside
    }
    return inside
  }
}
