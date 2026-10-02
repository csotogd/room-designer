import type { Opening } from '../../core/model/Opening'
import type { Project } from '../../core/model/Project'
import type { Wall } from '../../core/model/Wall'
import type { CommandStack } from '../commands/CommandStack'
import { ResizeOpeningCommand } from '../commands/PlanCommands'

/** Un gesto previsualiza varias medidas y guarda un único paso de deshacer. */
export class OpeningResize {
  private before: number | null = null

  constructor(
    private readonly project: Project,
    private readonly wall: Wall,
    private readonly opening: Opening,
    private readonly stack: CommandStack,
  ) {}

  preview(width: number): void {
    if (!Number.isFinite(width)) return
    this.before ??= this.opening.width
    this.project.resizeOpening(this.wall, this.opening,
      Math.min(Math.max(width, 0.3), this.wall.maxOpeningWidth(this.opening)))
  }

  commit(): void {
    if (this.before === null) return
    const width = this.opening.width
    const before = this.before
    this.before = null
    if (width === before) return
    this.project.resizeOpening(this.wall, this.opening, before)
    this.stack.execute(new ResizeOpeningCommand(this.project, this.wall, this.opening, width))
  }

  cancel(): void {
    if (this.before === null) return
    this.project.resizeOpening(this.wall, this.opening, this.before)
    this.before = null
  }
}
