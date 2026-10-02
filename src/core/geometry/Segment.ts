import { Point2D } from './Point2D'

/** Segmento 2D con operaciones de proyección usadas por snapping y aperturas. */
export class Segment {
  constructor(
    readonly start: Point2D,
    readonly end: Point2D,
  ) {}

  length(): number {
    return this.start.distanceTo(this.end)
  }

  direction(): Point2D {
    return this.end.sub(this.start).normalized()
  }

  pointAtDistance(distance: number): Point2D {
    return this.start.add(this.direction().scale(distance))
  }

  /** Distancia a lo largo del segmento de la proyección de `point`, acotada a [0, length]. */
  projectDistance(point: Point2D): number {
    const t = point.sub(this.start).dot(this.direction())
    return Math.min(Math.max(t, 0), this.length())
  }

  distanceToPoint(point: Point2D): number {
    return this.pointAtDistance(this.projectDistance(point)).distanceTo(point)
  }

  intersects(other: Segment): boolean {
    for (const axis of ['x', 'y'] as const) {
      if (Math.max(this.start[axis], this.end[axis]) < Math.min(other.start[axis], other.end[axis]) ||
          Math.max(other.start[axis], other.end[axis]) < Math.min(this.start[axis], this.end[axis])) return false
    }
    const side = (a: Point2D, b: Point2D, p: Point2D) => b.sub(a).perp().dot(p.sub(a))
    return side(this.start, this.end, other.start) * side(this.start, this.end, other.end) <= 0 &&
      side(other.start, other.end, this.start) * side(other.start, other.end, this.end) <= 0
  }
}
