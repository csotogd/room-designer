import type { Point2D } from '../../../core/geometry/Point2D'
import type { Wall } from '../../../core/model/Wall'
import { WallDrag, type WallDragMode } from '../../../app/editor/WallDrag'
import type { Tool2D, ToolContext } from '../../types'

/** Manipulación directa del contorno, con tiradores en sus esquinas. */
export class WallEditTool implements Tool2D {
  private drag: WallDrag | null = null
  private invalid = false

  constructor(
    private readonly ctx: Pick<ToolContext, 'project' | 'stack' | 'selection' | 'select' | 'hint'>,
    private readonly onCommit: () => void = () => {},
    private readonly tolerance: () => number = () => 0.2,
  ) {
    ctx.hint('Arrastra una pared para moverla o una esquina para cambiar su longitud. Esc cancela.')
  }

  onDown(world: Point2D): void {
    const selected = this.ctx.selection()
    const walls = selected?.kind === 'wall'
      ? [selected.wall, ...this.ctx.project.floorPlan.walls.filter(wall => wall !== selected.wall)]
      : this.ctx.project.floorPlan.walls
    for (const wall of walls) {
      for (const mode of ['start', 'end'] as const) {
        if (wall[mode].distanceTo(world) <= this.tolerance()) {
          this.begin(wall, mode, world)
          return
        }
      }
    }
    const wall = this.ctx.project.floorPlan.wallAt(world, this.tolerance())
    if (wall) this.begin(wall, 'move', world)
    else this.ctx.select(null)
  }

  onMove(world: Point2D): void {
    if (!this.drag) return
    this.invalid = !this.drag.preview(world)
    this.ctx.hint(this.invalid ? 'No cabe ahí: la pared cruza el contorno, una apertura o un mueble.' : '')
  }

  onUp(): void {
    if (!this.drag) return
    this.drag.commit()
    this.drag = null
    this.invalid = false
    this.onCommit()
  }

  cancel(): void {
    this.drag?.cancel()
    this.drag = null
    this.invalid = false
  }

  onKey(key: string): boolean {
    if (key !== 'Escape') return false
    this.cancel()
    return true
  }

  drawOverlay(ctx: CanvasRenderingContext2D, toScreen: (p: Point2D) => [number, number]): void {
    const selected = this.ctx.selection()
    for (const wall of this.ctx.project.floorPlan.walls) {
      const active = selected?.kind === 'wall' && selected.wall === wall
      const [ax, ay] = toScreen(wall.start)
      const [bx, by] = toScreen(wall.end)
      const color = active ? (this.invalid ? '#bf3f36' : '#0058a3') : '#66645f'
      ctx.font = `${active ? '600' : '400'} 12px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#f8f7f4'
      const label = `${wall.length().toLocaleString('es-ES', { maximumFractionDigits: 2 })} m`
      const width = ctx.measureText(label).width + 14
      ctx.fillRect((ax + bx - width) / 2, (ay + by) / 2 - 28, width, 20)
      ctx.fillStyle = color
      ctx.fillText(label, (ax + bx) / 2, (ay + by) / 2 - 18)
      for (const [x, y] of [[ax, ay], [bx, by]]) {
        ctx.beginPath()
        ctx.arc(x!, y!, active ? 7 : 5, 0, Math.PI * 2)
        ctx.fillStyle = active ? color : '#ffffff'
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = active ? '#ffffff' : '#66645f'
        ctx.stroke()
      }
    }
  }

  private begin(wall: Wall, mode: WallDragMode, world: Point2D): void {
    this.ctx.select({ kind: 'wall', wall })
    this.drag = new WallDrag(this.ctx.project, wall, mode, world, this.ctx.stack)
  }
}
