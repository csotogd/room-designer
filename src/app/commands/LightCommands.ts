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

/** Encender/apagar es su propia inversa. */
export class ToggleLightCommand implements Command {
  constructor(
    private readonly project: Project,
    private readonly light: LightPoint,
  ) {}

  execute(): void {
    this.project.toggleLight(this.light)
  }

  undo(): void {
    this.project.toggleLight(this.light)
  }
}

export class SetLightIntensityCommand implements Command {
  private readonly from: number

  constructor(
    private readonly project: Project,
    private readonly light: LightPoint,
    private readonly to: number,
  ) {
    this.from = light.intensity
  }

  execute(): void {
    this.project.updateLight(this.light, (l) => l.setIntensity(this.to))
  }

  undo(): void {
    this.project.updateLight(this.light, (l) => l.setIntensity(this.from))
  }
}

export class SetLightTemperatureCommand implements Command {
  private readonly from: number

  constructor(
    private readonly project: Project,
    private readonly light: LightPoint,
    private readonly to: number,
  ) {
    this.from = light.temperatureK
  }

  execute(): void {
    this.project.updateLight(this.light, (l) => l.setTemperature(this.to))
  }

  undo(): void {
    this.project.updateLight(this.light, (l) => l.setTemperature(this.from))
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
