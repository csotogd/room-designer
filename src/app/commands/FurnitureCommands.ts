import type { Furniture } from '../../core/model/Furniture'
import type { Project } from '../../core/model/Project'
import type { Command } from './Command'

export class MoveFurnitureCommand implements Command {
  private readonly fromX: number
  private readonly fromZ: number

  constructor(
    private readonly project: Project,
    private readonly furniture: Furniture,
    private readonly toX: number,
    private readonly toZ: number,
  ) {
    this.fromX = furniture.position.x
    this.fromZ = furniture.position.z
  }

  execute(): void {
    this.project.moveFurniture(this.furniture, this.toX, this.toZ)
  }

  undo(): void {
    this.project.moveFurniture(this.furniture, this.fromX, this.fromZ)
  }
}

export class RotateFurnitureCommand implements Command {
  private readonly fromRadians: number

  constructor(
    private readonly project: Project,
    private readonly furniture: Furniture,
    private readonly toRadians: number,
  ) {
    this.fromRadians = furniture.rotationY
  }

  execute(): void {
    this.project.rotateFurniture(this.furniture, this.toRadians)
  }

  undo(): void {
    this.project.rotateFurniture(this.furniture, this.fromRadians)
  }
}
