const EPS = 1e-6

/** Punto/vector 2D inmutable en coordenadas de plano (metros). */
export class Point2D {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  add(other: Point2D): Point2D {
    return new Point2D(this.x + other.x, this.y + other.y)
  }

  sub(other: Point2D): Point2D {
    return new Point2D(this.x - other.x, this.y - other.y)
  }

  scale(factor: number): Point2D {
    return new Point2D(this.x * factor, this.y * factor)
  }

  dot(other: Point2D): number {
    return this.x * other.x + this.y * other.y
  }

  length(): number {
    return Math.hypot(this.x, this.y)
  }

  distanceTo(other: Point2D): number {
    return this.sub(other).length()
  }

  normalized(): Point2D {
    const len = this.length()
    if (len < EPS) throw new Error('No se puede normalizar un vector nulo')
    return this.scale(1 / len)
  }

  /** Perpendicular (giro de 90° antihorario). */
  perp(): Point2D {
    return new Point2D(-this.y, this.x)
  }

  equals(other: Point2D, eps: number = EPS): boolean {
    return Math.abs(this.x - other.x) <= eps && Math.abs(this.y - other.y) <= eps
  }
}
