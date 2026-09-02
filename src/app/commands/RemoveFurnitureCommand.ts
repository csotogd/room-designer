import type { Furniture } from '../../core/model/Furniture'
import type { Point3D } from '../../core/geometry/Point3D'
import type { Project } from '../../core/model/Project'
import type { Command } from './Command'

interface DependentSnapshot {
  furniture: Furniture
  position: Point3D
  supportedBy?: Furniture
}

/** Borra un mueble recordando cómo estaba apoyado todo, para poder deshacer. */
export class RemoveFurnitureCommand implements Command {
  private snapshots: DependentSnapshot[] = []

  constructor(
    private readonly project: Project,
    private readonly furniture: Furniture,
  ) {}

  execute(): void {
    this.snapshots = [this.furniture, ...this.project.dependentsOf(this.furniture)].map((f) => ({
      furniture: f,
      position: f.position,
      supportedBy: f.supportedBy,
    }))
    this.project.removeFurniture(this.furniture)
  }

  undo(): void {
    for (const snapshot of this.snapshots) {
      snapshot.furniture.position = snapshot.position
      snapshot.furniture.supportedBy = snapshot.supportedBy
    }
    this.project.addFurniture(this.furniture)
  }
}
