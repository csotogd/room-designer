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
  private index = -1

  constructor(
    private readonly project: Project,
    private readonly furniture: Furniture,
  ) {}

  execute(): void {
    // Si el mueble ya no está, deshacer no debe "resucitarlo" (duplicado).
    this.index = this.project.furniture.indexOf(this.furniture)
    if (this.index < 0) return
    this.snapshots = [this.furniture, ...this.project.dependentsOf(this.furniture)].map((f) => ({
      furniture: f,
      position: f.position,
      supportedBy: f.supportedBy,
    }))
    this.project.removeFurniture(this.furniture)
  }

  undo(): void {
    if (this.index < 0) return
    for (const snapshot of this.snapshots) {
      snapshot.furniture.position = snapshot.position
      snapshot.furniture.supportedBy = snapshot.supportedBy
    }
    // En su índice original: el orden de la lista es orden de dibujo/carrito.
    this.project.addFurniture(this.furniture, this.index)
  }
}
