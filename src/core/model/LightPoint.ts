import { Point3D } from '../geometry/Point3D'
import { newId } from '../util/id'

export type LightKind = 'ceiling' | 'wall' | 'floor'

export const MIN_TEMPERATURE_K = 2000
export const MAX_TEMPERATURE_K = 6500

/**
 * Punto de luz del dominio: el usuario lo coloca y edita como un mueble más.
 * El renderer lo traduce a luces de Three.js.
 */
export abstract class LightPoint {
  readonly id: string
  position: Point3D
  on = true
  intensity = 1
  temperatureK = 4000

  constructor(position: Point3D, id?: string) {
    this.position = position
    this.id = id ?? newId('light')
  }

  abstract get kind(): LightKind

  setIntensity(value: number): void {
    this.intensity = Math.min(Math.max(value, 0), 1)
  }

  setTemperature(kelvin: number): void {
    this.temperatureK = Math.min(Math.max(kelvin, MIN_TEMPERATURE_K), MAX_TEMPERATURE_K)
  }

  toggle(): void {
    this.on = !this.on
  }
}

export class CeilingLight extends LightPoint {
  constructor(x: number, z: number, ceilingHeight: number, id?: string) {
    super(new Point3D(x, ceilingHeight, z), id)
  }

  get kind(): LightKind {
    return 'ceiling'
  }
}

export class WallLight extends LightPoint {
  constructor(x: number, z: number, height = 1.8, id?: string) {
    super(new Point3D(x, height, z), id)
  }

  get kind(): LightKind {
    return 'wall'
  }
}

export class FloorLamp extends LightPoint {
  constructor(x: number, z: number, height = 1.5, id?: string) {
    super(new Point3D(x, height, z), id)
  }

  get kind(): LightKind {
    return 'floor'
  }
}
