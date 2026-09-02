const EPS = 1e-6

/** Punto 3D inmutable: x, z en planta; y = elevación desde el suelo. */
export class Point3D {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}

  translate(dx: number, dy: number, dz: number): Point3D {
    return new Point3D(this.x + dx, this.y + dy, this.z + dz)
  }

  equals(other: Point3D, eps: number = EPS): boolean {
    return (
      Math.abs(this.x - other.x) <= eps &&
      Math.abs(this.y - other.y) <= eps &&
      Math.abs(this.z - other.z) <= eps
    )
  }
}
