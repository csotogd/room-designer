import type { LightPoint } from '../../core/model/LightPoint'
import type { Point3D } from '../../core/geometry/Point3D'
import type { Project } from '../../core/model/Project'
import type { Command } from './Command'

export class MoveLightCommand implements Command {
  private readonly from: Point3D

  constructor(
    private readonly project: Project,
    private readonly light: LightPoint,
    private readonly to: Point3D,
  ) {
    this.from = light.position
  }

  execute(): void {
    this.project.moveLight(this.light, this.to)
  }

  undo(): void {
    this.project.moveLight(this.light, this.from)
  }
}

export class AddLightCommand implements Command {
  constructor(
    private readonly project: Project,
    private readonly light: LightPoint,
  ) {}

  execute(): void {
    this.project.addLight(this.light)
  }

  undo(): void {
    this.project.removeLight(this.light)
  }
}

export class RemoveLightCommand implements Command {
  constructor(
    private readonly project: Project,
    private readonly light: LightPoint,
  ) {}

  execute(): void {
    this.project.removeLight(this.light)
  }

  undo(): void {
    this.project.addLight(this.light)
  }
}
