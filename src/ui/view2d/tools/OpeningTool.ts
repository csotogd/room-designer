import { Point2D } from '../../../core/geometry/Point2D'
import { Door } from '../../../core/model/Door'
import { Window } from '../../../core/model/Window'
import type { Wall } from '../../../core/model/Wall'
import { AddOpeningCommand } from '../../../app/commands/PlanCommands'
import type { Tool2D, ToolContext } from '../../types'

const WALL_TOLERANCE = 0.25
const DOOR_WIDTH = 0.9
const WINDOW_WIDTH = 1.2

/** Coloca puertas o ventanas ancladas a la pared bajo el cursor. */
export class OpeningTool implements Tool2D {
  private hovered: { wall: Wall; offset: number } | null = null

  constructor(
    private readonly ctx: ToolContext,
    private readonly kind: 'door' | 'window',
  ) {
    ctx.hint(
      kind === 'door'
        ? 'Puerta: clic sobre una pared para colocarla.'
        : 'Ventana: clic sobre una pared para colocarla.',
    )
  }

  onDown(world: Point2D): void {
    const target = this.findTarget(world)
    if (!target) {
      this.ctx.hint('Acerca el cursor a una pared para colocar la apertura.')
      return
    }
    const width = this.kind === 'door' ? DOOR_WIDTH : WINDOW_WIDTH
    const wallLength = target.wall.length()
    const offset = Math.min(Math.max(target.offset - width / 2, 0), Math.max(wallLength - width, 0))
    const opening = this.kind === 'door' ? new Door(offset, width) : new Window(offset, width)
    try {
      this.ctx.stack.execute(new AddOpeningCommand(this.ctx.project, target.wall, opening))
    } catch (error) {
      this.ctx.hint((error as Error).message)
    }
  }

  onMove(world: Point2D): void {
    this.hovered = this.findTarget(world)
  }

  onUp(): void {}

  cancel(): void {
    this.hovered = null
  }

  drawOverlay(
    ctx: CanvasRenderingContext2D,
    toScreen: (p: Point2D) => [number, number],
    scale: number,
  ): void {
    if (!this.hovered) return
    const { wall, offset } = this.hovered
    const width = this.kind === 'door' ? DOOR_WIDTH : WINDOW_WIDTH
    const segment = wall.segment()
    const from = Math.min(Math.max(offset - width / 2, 0), Math.max(wall.length() - width, 0))
    const [x1, y1] = toScreen(segment.pointAtDistance(from))
    const [x2, y2] = toScreen(segment.pointAtDistance(Math.min(from + width, wall.length())))
    ctx.strokeStyle = this.kind === 'door' ? '#b08968' : '#5a8bb0'
    ctx.lineWidth = Math.max(wall.thickness * scale, 5) + 4
    ctx.globalAlpha = 0.6
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  private findTarget(world: Point2D): { wall: Wall; offset: number } | null {
    const wall = this.ctx.project.floorPlan.wallAt(world, WALL_TOLERANCE)
    if (!wall) return null
    return { wall, offset: wall.segment().projectDistance(world) }
  }
}
