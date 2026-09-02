import { Point2D } from '../../../core/geometry/Point2D'
import { CeilingLight, FloorLamp, WallLight } from '../../../core/model/LightPoint'
import { AddLightCommand } from '../../../app/commands/LightCommands'
import type { Tool2D, ToolContext } from '../../types'

const WALL_TOLERANCE = 0.4
const WALL_LIGHT_HEIGHT = 1.8
const FLOOR_LAMP_HEIGHT = 1.5

/** Coloca puntos de luz: plafón de techo, aplique de pared o lámpara de pie. */
export class LightTool implements Tool2D {
  constructor(private readonly ctx: ToolContext) {
    ctx.hint('Luz: clic para colocar el tipo elegido en el desplegable.')
  }

  onDown(world: Point2D): void {
    const kind = this.ctx.lightKind()
    if (kind === 'wall') {
      const wall = this.ctx.project.floorPlan.wallAt(world, WALL_TOLERANCE)
      if (!wall) {
        this.ctx.hint('Un aplique va sobre una pared: acércate a una.')
        return
      }
      const anchor = wall.segment().pointAtDistance(wall.segment().projectDistance(world))
      this.ctx.stack.execute(
        new AddLightCommand(this.ctx.project, new WallLight(anchor.x, anchor.y, WALL_LIGHT_HEIGHT)),
      )
      return
    }
    const light =
      kind === 'ceiling'
        ? new CeilingLight(world.x, world.y, this.ctx.project.ceilingHeight)
        : new FloorLamp(world.x, world.y, FLOOR_LAMP_HEIGHT)
    this.ctx.stack.execute(new AddLightCommand(this.ctx.project, light))
  }

  onMove(): void {}
  onUp(): void {}
  cancel(): void {}
  drawOverlay(): void {}
}
