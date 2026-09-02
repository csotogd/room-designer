import { Point2D } from '../../../core/geometry/Point2D'
import type { Furniture } from '../../../core/model/Furniture'
import { MoveFurnitureCommand } from '../../../app/commands/FurnitureCommands'
import { dropFurniture } from '../../../app/editor/FurnitureDrop'
import { fitsInRoom } from '../../../app/editor/RoomBounds'
import type { Tool2D, ToolContext } from '../../types'

const LIGHT_RADIUS = 0.3
const WALL_TOLERANCE = 0.15

/** Selección y arrastre: luces > muebles (el más alto) > paredes. */
export class SelectTool implements Tool2D {
  private dragging: {
    furniture: Furniture
    grab: Point2D
    start: Point2D
    moved: boolean
  } | null = null

  constructor(private readonly ctx: ToolContext) {
    ctx.hint('Seleccionar: clic para elegir, arrastra para mover. R rota, Supr borra.')
  }

  onDown(world: Point2D): void {
    const light = this.ctx.project.lights.find(
      (l) => new Point2D(l.position.x, l.position.z).distanceTo(world) < LIGHT_RADIUS,
    )
    if (light) {
      this.ctx.select({ kind: 'light', light })
      return
    }

    const hits = this.ctx.project.furniture.filter((f) => f.containsPlanPoint(world))
    if (hits.length > 0) {
      const furniture = hits.reduce((top, f) => (f.topY() > top.topY() ? f : top))
      this.ctx.select({ kind: 'furniture', furniture })
      this.dragging = {
        furniture,
        grab: world.sub(new Point2D(furniture.position.x, furniture.position.z)),
        start: new Point2D(furniture.position.x, furniture.position.z),
        moved: false,
      }
      return
    }

    const wall = this.ctx.project.floorPlan.wallAt(world, WALL_TOLERANCE)
    this.ctx.select(wall ? { kind: 'wall', wall } : null)
  }

  onMove(world: Point2D): void {
    if (!this.dragging) return
    const target = world.sub(this.dragging.grab)
    this.ctx.project.moveFurniture(this.dragging.furniture, target.x, target.y)
    this.dragging.moved = true
  }

  onUp(): void {
    if (!this.dragging) return
    const { furniture, start, moved } = this.dragging
    this.dragging = null
    if (!moved) return

    const final = new Point2D(furniture.position.x, furniture.position.z)
    // Volver al origen y ejecutar el movimiento como comando, para que quede en el undo.
    this.ctx.project.moveFurniture(furniture, start.x, start.y)
    if (!fitsInRoom(this.ctx.project.floorPlan, furniture.item, final.x, final.y, furniture.rotationY)) {
      this.ctx.hint('Ahí no cabe: el mueble debe quedar dentro de la habitación.')
      return
    }
    this.ctx.stack.execute(new MoveFurnitureCommand(this.ctx.project, furniture, final.x, final.y))
    dropFurniture(this.ctx.project, furniture, final.x, final.y)
  }

  cancel(): void {
    this.dragging = null
  }

  drawOverlay(): void {}
}
