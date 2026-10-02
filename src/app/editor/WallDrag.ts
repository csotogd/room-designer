import { Point2D } from '../../core/geometry/Point2D'
import type { Project } from '../../core/model/Project'
import type { Wall } from '../../core/model/Wall'
import type { CommandStack } from '../commands/CommandStack'
import { fitsInRoom } from './RoomBounds'

export type WallDragMode = 'move' | 'start' | 'end'

/** Un arrastre modifica también las esquinas compartidas, con un único undo. */
export class WallDrag {
  private readonly start: Point2D
  private readonly end: Point2D

  constructor(
    private readonly project: Project,
    private readonly wall: Wall,
    private readonly mode: WallDragMode,
    private readonly grab: Point2D,
    private readonly stack: CommandStack,
  ) {
    this.start = wall.start
    this.end = wall.end
  }

  preview(point: Point2D): boolean {
    let start = this.start
    let end = this.end
    const pointerDelta = point.sub(this.grab)
    if (this.mode === 'move') {
      const normal = this.end.sub(this.start).normalized().perp()
      const delta = normal.scale(pointerDelta.dot(normal))
      start = start.add(delta)
      end = end.add(delta)
    } else if (this.mode === 'start') start = start.add(pointerDelta)
    else end = end.add(pointerDelta)
    try {
      const candidate = this.project.floorPlan.withWallGeometry(this.wall, start, end)
      if (!this.project.furniture.every(f => fitsInRoom(candidate, f.item, f.position.x, f.position.z, f.rotationY))) return false
      this.project.reshapeWall(this.wall, start, end)
      return true
    } catch {
      return false
    }
  }

  commit(): void {
    if (this.unchanged()) return
    const { start, end } = this.wall
    this.cancel()
    this.stack.execute({
      execute: () => this.project.reshapeWall(this.wall, start, end),
      undo: () => this.project.reshapeWall(this.wall, this.start, this.end),
    })
  }

  cancel(): void {
    if (!this.unchanged()) this.project.reshapeWall(this.wall, this.start, this.end)
  }

  private unchanged(): boolean {
    return this.wall.start.equals(this.start) && this.wall.end.equals(this.end)
  }
}
