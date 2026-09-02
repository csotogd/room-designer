import type { CatalogItem } from '../../core/model/CatalogItem'
import type { Furniture } from '../../core/model/Furniture'
import type { Project } from '../../core/model/Project'
import type { Command } from './Command'

export class PlaceFurnitureCommand implements Command {
  private furniture?: Furniture

  constructor(
    private readonly project: Project,
    private readonly item: CatalogItem,
    private readonly x: number,
    private readonly z: number,
  ) {}

  execute(): void {
    if (this.furniture) {
      this.project.addFurniture(this.furniture)
    } else {
      this.furniture = this.project.placeFurniture(this.item, this.x, this.z)
    }
  }

  undo(): void {
    if (this.furniture) this.project.removeFurniture(this.furniture)
  }

  placed(): Furniture | undefined {
    return this.furniture
  }
}

export class PlaceOnTopCommand implements Command {
  private furniture?: Furniture

  constructor(
    private readonly project: Project,
    private readonly item: CatalogItem,
    private readonly support: Furniture,
  ) {}

  execute(): void {
    if (this.furniture) {
      this.furniture.supportedBy = this.support
      this.project.addFurniture(this.furniture)
    } else {
      this.furniture = this.project.placeOnTop(this.item, this.support)
    }
  }

  undo(): void {
    if (this.furniture) this.project.removeFurniture(this.furniture)
  }

  placed(): Furniture | undefined {
    return this.furniture
  }
}
