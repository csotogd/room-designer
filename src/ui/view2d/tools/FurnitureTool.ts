import { Point2D } from '../../../core/geometry/Point2D'
import type { Furniture } from '../../../core/model/Furniture'
import {
  PlaceFurnitureCommand,
  PlaceOnTopCommand,
} from '../../../app/commands/PlaceFurnitureCommand'
import type { Tool2D, ToolContext } from '../../types'

/**
 * Coloca el artículo elegido del catálogo. Si el clic cae sobre una superficie
 * (mesa, armario…), el objeto se apoya encima; si no, va al suelo.
 */
export class FurnitureTool implements Tool2D {
  private cursor: Point2D | null = null

  constructor(private readonly ctx: ToolContext) {
    ctx.hint('Mueble: clic para colocar. Sobre una mesa/armario se apoya encima.')
  }

  onDown(world: Point2D): void {
    const item = this.ctx.catalog.get(this.ctx.catalogItemId())
    const support = this.findSupport(world)
    try {
      if (support && support.item.id !== item.id) {
        const command = new PlaceOnTopCommand(this.ctx.project, item, support)
        this.ctx.stack.execute(command)
        const placed = command.placed()
        if (placed) this.ctx.select({ kind: 'furniture', furniture: placed })
      } else {
        const command = new PlaceFurnitureCommand(this.ctx.project, item, world.x, world.y)
        this.ctx.stack.execute(command)
        const placed = command.placed()
        if (placed) this.ctx.select({ kind: 'furniture', furniture: placed })
      }
    } catch (error) {
      this.ctx.hint((error as Error).message)
    }
  }

  onMove(world: Point2D): void {
    this.cursor = world
  }

  onUp(): void {}

  cancel(): void {
    this.cursor = null
  }

  drawOverlay(
    ctx: CanvasRenderingContext2D,
    toScreen: (p: Point2D) => [number, number],
    scale: number,
  ): void {
    if (!this.cursor) return
    const item = this.ctx.catalog.get(this.ctx.catalogItemId())
    const [x, y] = toScreen(this.cursor)
    ctx.save()
    ctx.translate(x, y)
    ctx.globalAlpha = 0.5
    ctx.fillStyle = item.color
    ctx.fillRect(
      (-item.width / 2) * scale,
      (-item.depth / 2) * scale,
      item.width * scale,
      item.depth * scale,
    )
    ctx.restore()
  }

  /** Superficie más alta cuya huella contiene el punto. */
  private findSupport(world: Point2D): Furniture | null {
    const candidates = this.ctx.project.furniture.filter(
      (f) => f.item.isSurface && f.containsPlanPoint(world),
    )
    if (candidates.length === 0) return null
    return candidates.reduce((top, f) => (f.topY() > top.topY() ? f : top))
  }
}
