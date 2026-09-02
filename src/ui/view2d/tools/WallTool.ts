import { Point2D } from '../../../core/geometry/Point2D'
import { Wall } from '../../../core/model/Wall'
import { AddWallCommand } from '../../../app/commands/PlanCommands'
import type { Tool2D, ToolContext } from '../../types'

const GRID_SNAP = 0.1
const POINT_SNAP = 0.2

/** Dibuja cadenas de paredes; clic cerca del punto inicial cierra el bucle. */
export class WallTool implements Tool2D {
  private chain: Point2D[] = []
  private cursor: Point2D | null = null

  constructor(private readonly ctx: ToolContext) {
    ctx.hint('Pared: clic para cada esquina; clic en el punto inicial para cerrar. Esc termina.')
  }

  onDown(world: Point2D): void {
    const point = this.snap(world)
    const first = this.chain[0]
    if (this.chain.length >= 3 && first && point.distanceTo(first) < POINT_SNAP) {
      this.commitSegment(this.chain[this.chain.length - 1]!, first)
      this.chain = []
      this.ctx.hint('Habitación cerrada. Puedes seguir dibujando o cambiar de herramienta.')
      return
    }
    const last = this.chain[this.chain.length - 1]
    if (last) {
      if (last.distanceTo(point) < GRID_SNAP) return
      this.commitSegment(last, point)
    }
    this.chain.push(point)
  }

  onMove(world: Point2D): void {
    this.cursor = this.snap(world)
  }

  onUp(): void {}

  onKey(key: string): boolean {
    if (key === 'Escape' || key === 'Enter') {
      this.chain = []
      return true
    }
    return false
  }

  cancel(): void {
    this.chain = []
  }

  drawOverlay(
    ctx: CanvasRenderingContext2D,
    toScreen: (p: Point2D) => [number, number],
  ): void {
    const last = this.chain[this.chain.length - 1]
    if (last && this.cursor) {
      const [x1, y1] = toScreen(last)
      const [x2, y2] = toScreen(this.cursor)
      ctx.strokeStyle = '#0058a3'
      ctx.lineWidth = 3
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])
      const meters = last.distanceTo(this.cursor).toFixed(2)
      ctx.fillStyle = '#0058a3'
      ctx.font = '12px sans-serif'
      ctx.fillText(`${meters} m`, (x1 + x2) / 2 + 8, (y1 + y2) / 2 - 8)
    }
    const first = this.chain[0]
    if (first && this.chain.length >= 3) {
      const [x, y] = toScreen(first)
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.strokeStyle = '#0058a3'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  private commitSegment(from: Point2D, to: Point2D): void {
    this.ctx.stack.execute(new AddWallCommand(this.ctx.project, new Wall(from, to)))
  }

  private snap(world: Point2D): Point2D {
    for (const wall of this.ctx.project.floorPlan.walls) {
      for (const endpoint of [wall.start, wall.end]) {
        if (endpoint.distanceTo(world) < POINT_SNAP) return endpoint
      }
    }
    const first = this.chain[0]
    if (first && first.distanceTo(world) < POINT_SNAP) return first
    return new Point2D(
      Math.round(world.x / GRID_SNAP) * GRID_SNAP,
      Math.round(world.y / GRID_SNAP) * GRID_SNAP,
    )
  }
}
