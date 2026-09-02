import { Point2D } from '../geometry/Point2D'
import { Point3D } from '../geometry/Point3D'
import { EventEmitter } from '../events/EventEmitter'
import { FloorPlan } from './FloorPlan'
import { Furniture } from './Furniture'
import { Sun } from './Sun'
import type { CatalogItem } from './CatalogItem'
import type { LightPoint } from './LightPoint'
import type { Opening } from './Opening'
import type { Wall } from './Wall'

export interface ProjectEvents extends Record<string, unknown> {
  changed: { kind: string }
}

/**
 * Raíz del dominio: plano + muebles + luces + hora del día.
 * Toda mutación pasa por aquí y emite `changed`, del que se cuelgan las vistas.
 */
export class Project {
  readonly events = new EventEmitter<ProjectEvents>()
  private readonly _furniture: Furniture[] = []
  private readonly _lights: LightPoint[] = []
  private _timeOfDay = 12

  constructor(
    readonly floorPlan: FloorPlan,
    readonly ceilingHeight = 2.5,
  ) {}

  get furniture(): readonly Furniture[] {
    return this._furniture
  }

  get lights(): readonly LightPoint[] {
    return this._lights
  }

  get timeOfDay(): number {
    return this._timeOfDay
  }

  // ── Plano ────────────────────────────────────────────────────────────────

  addWall(wall: Wall): void {
    this.floorPlan.addWall(wall)
    this.emitChanged('wall-added')
  }

  removeWall(wall: Wall): void {
    this.floorPlan.removeWall(wall)
    this.emitChanged('wall-removed')
  }

  addOpening(wall: Wall, opening: Opening): void {
    wall.addOpening(opening)
    this.emitChanged('opening-added')
  }

  removeOpening(wall: Wall, opening: Opening): void {
    wall.removeOpening(opening)
    this.emitChanged('opening-removed')
  }

  moveWall(wall: Wall, start: Point2D, end: Point2D): void {
    wall.moveTo(start, end)
    this.emitChanged('wall-moved')
  }

  /** Desliza una apertura por su pared (validado por la pared). */
  moveOpening(wall: Wall, opening: Opening, offset: number): void {
    wall.moveOpening(opening, offset)
    this.emitChanged('opening-moved')
  }

  // ── Muebles ──────────────────────────────────────────────────────────────

  placeFurniture(item: CatalogItem, x: number, z: number): Furniture {
    const furniture = new Furniture(item, new Point3D(x, 0, z))
    this.addFurniture(furniture)
    return furniture
  }

  /** Coloca un objeto centrado encima de un mueble que sea superficie. */
  placeOnTop(item: CatalogItem, support: Furniture): Furniture {
    this.assertIsSurface(support)
    const furniture = new Furniture(
      item,
      new Point3D(support.position.x, support.topY(), support.position.z),
      0,
      support,
    )
    this.addFurniture(furniture)
    return furniture
  }

  addFurniture(furniture: Furniture): void {
    this._furniture.push(furniture)
    this.emitChanged('furniture-added')
  }

  /**
   * Re-apoya un mueble existente sobre otro, validando superficie y ciclos.
   * Sin x/z se centra sobre el soporte; con ellos conserva el punto de suelta.
   */
  support(furniture: Furniture, support: Furniture, x?: number, z?: number): void {
    if (furniture === support) {
      throw new Error('Un mueble no puede apoyarse sobre sí mismo')
    }
    this.assertIsSurface(support)
    if (support.supportChain().includes(furniture)) {
      throw new Error('Apoyo circular: el soporte ya descansa sobre este mueble')
    }
    const targetX = x ?? support.position.x
    const targetZ = z ?? support.position.z
    this.translateWithDependents(
      furniture,
      targetX - furniture.position.x,
      support.topY() - furniture.position.y,
      targetZ - furniture.position.z,
    )
    furniture.supportedBy = support
    this.emitChanged('furniture-moved')
  }

  /** Mueve un mueble en planta; lo que tiene encima viaja con él. */
  moveFurniture(furniture: Furniture, x: number, z: number): void {
    this.translateWithDependents(furniture, x - furniture.position.x, 0, z - furniture.position.z)
    this.emitChanged('furniture-moved')
  }

  rotateFurniture(furniture: Furniture, radians: number): void {
    furniture.rotationY = radians
    this.emitChanged('furniture-rotated')
  }

  /** Suelta un mueble de su soporte y lo deja en el suelo. */
  clearSupport(furniture: Furniture): void {
    this.dropToFloor(furniture)
    this.emitChanged('furniture-moved')
  }

  /** Elimina un mueble; lo que estaba apoyado en él cae al suelo. */
  removeFurniture(furniture: Furniture): void {
    const index = this._furniture.indexOf(furniture)
    if (index < 0) return
    this._furniture.splice(index, 1)
    for (const dependent of this._furniture.filter((f) => f.supportedBy === furniture)) {
      this.dropToFloor(dependent)
    }
    this.emitChanged('furniture-removed')
  }

  /** Muebles que descansan (directa o indirectamente) sobre `furniture`. */
  dependentsOf(furniture: Furniture): Furniture[] {
    return this._furniture.filter((f) => f.supportChain().includes(furniture))
  }

  // ── Luces ────────────────────────────────────────────────────────────────

  addLight(light: LightPoint): void {
    this._lights.push(light)
    this.emitChanged('light-added')
  }

  removeLight(light: LightPoint): void {
    const index = this._lights.indexOf(light)
    if (index >= 0) this._lights.splice(index, 1)
    this.emitChanged('light-removed')
  }

  moveLight(light: LightPoint, position: Point3D): void {
    light.position = position
    this.emitChanged('light-moved')
  }

  toggleLight(light: LightPoint): void {
    light.toggle()
    this.emitChanged('light-changed')
  }

  updateLight(light: LightPoint, update: (l: LightPoint) => void): void {
    update(light)
    this.emitChanged('light-changed')
  }

  // ── Sol ──────────────────────────────────────────────────────────────────

  setTimeOfDay(hours: number): void {
    this._timeOfDay = ((hours % 24) + 24) % 24
    this.emitChanged('time-changed')
  }

  sunAltitude(): number {
    return Sun.altitude(this._timeOfDay)
  }

  sunAzimuth(): number {
    return Sun.azimuth(this._timeOfDay)
  }

  /** Desplaza un mueble y todo lo apoyado (directa o indirectamente) sobre él. */
  private translateWithDependents(furniture: Furniture, dx: number, dy: number, dz: number): void {
    for (const moved of [furniture, ...this.dependentsOf(furniture)]) {
      moved.position = moved.position.translate(dx, dy, dz)
    }
  }

  /** Baja un mueble (y su pila) al suelo y lo desvincula de su soporte. */
  private dropToFloor(furniture: Furniture): void {
    this.translateWithDependents(furniture, 0, -furniture.position.y, 0)
    furniture.supportedBy = undefined
  }

  private assertIsSurface(support: Furniture): void {
    if (!support.item.isSurface) {
      throw new Error(`"${support.item.name}" no es una superficie de apoyo`)
    }
  }

  private emitChanged(kind: string): void {
    this.events.emit('changed', { kind })
  }
}
