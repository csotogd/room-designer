import type { FloorFinish, WallFinish } from '../../core/model/Finishes'
import type { Project } from '../../core/model/Project'
import type { Command } from './Command'

export class SetWallFinishCommand implements Command {
  private readonly previous: WallFinish

  constructor(
    private readonly project: Project,
    private readonly finish: WallFinish,
  ) {
    this.previous = project.wallFinish
  }

  execute(): void {
    this.project.setWallFinish(this.finish)
  }

  undo(): void {
    this.project.setWallFinish(this.previous)
  }
}

export class SetFloorFinishCommand implements Command {
  private readonly previous: FloorFinish

  constructor(
    private readonly project: Project,
    private readonly finish: FloorFinish,
  ) {
    this.previous = project.floorFinish
  }

  execute(): void {
    this.project.setFloorFinish(this.finish)
  }

  undo(): void {
    this.project.setFloorFinish(this.previous)
  }
}
