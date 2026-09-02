import type { Opening } from '../../core/model/Opening'
import type { Project } from '../../core/model/Project'
import type { Wall } from '../../core/model/Wall'
import type { Command } from './Command'

export class AddWallCommand implements Command {
  constructor(
    private readonly project: Project,
    private readonly wall: Wall,
  ) {}

  execute(): void {
    this.project.addWall(this.wall)
  }

  undo(): void {
    this.project.removeWall(this.wall)
  }
}

export class RemoveWallCommand implements Command {
  constructor(
    private readonly project: Project,
    private readonly wall: Wall,
  ) {}

  execute(): void {
    this.project.removeWall(this.wall)
  }

  undo(): void {
    this.project.addWall(this.wall)
  }
}

export class RemoveOpeningCommand implements Command {
  constructor(
    private readonly project: Project,
    private readonly wall: Wall,
    private readonly opening: Opening,
  ) {}

  execute(): void {
    this.project.removeOpening(this.wall, this.opening)
  }

  undo(): void {
    this.project.addOpening(this.wall, this.opening)
  }
}

export class MoveOpeningCommand implements Command {
  private readonly fromOffset: number

  constructor(
    private readonly project: Project,
    private readonly wall: Wall,
    private readonly opening: Opening,
    private readonly toOffset: number,
  ) {
    this.fromOffset = opening.offset
  }

  execute(): void {
    this.project.moveOpening(this.wall, this.opening, this.toOffset)
  }

  undo(): void {
    this.project.moveOpening(this.wall, this.opening, this.fromOffset)
  }
}

export class AddOpeningCommand implements Command {
  constructor(
    private readonly project: Project,
    private readonly wall: Wall,
    private readonly opening: Opening,
  ) {}

  execute(): void {
    this.project.addOpening(this.wall, this.opening)
  }

  undo(): void {
    this.project.removeOpening(this.wall, this.opening)
  }
}
