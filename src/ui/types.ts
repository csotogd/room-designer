import type { Point2D } from '../core/geometry/Point2D'
import type { Furniture } from '../core/model/Furniture'
import type { LightPoint, LightKind } from '../core/model/LightPoint'
import type { Project } from '../core/model/Project'
import type { Wall } from '../core/model/Wall'
import type { CommandStack } from '../app/commands/CommandStack'
import type { FurnitureCatalog } from '../app/catalog/FurnitureCatalog'

export type Selection =
  | { kind: 'furniture'; furniture: Furniture }
  | { kind: 'light'; light: LightPoint }
  | { kind: 'wall'; wall: Wall }

/** Servicios que el editor ofrece a las herramientas (patrón Strategy). */
export interface ToolContext {
  readonly project: Project
  readonly stack: CommandStack
  readonly catalog: FurnitureCatalog
  catalogItemId(): string
  lightKind(): LightKind
  selection(): Selection | null
  select(selection: Selection | null): void
  hint(message: string): void
  requestDraw(): void
}

/** Una herramienta 2D recibe eventos en coordenadas de mundo (metros). */
export interface Tool2D {
  onDown(world: Point2D, event: PointerEvent): void
  onMove(world: Point2D, event: PointerEvent): void
  onUp(world: Point2D, event: PointerEvent): void
  onKey?(key: string): boolean
  cancel(): void
  drawOverlay(ctx: CanvasRenderingContext2D, toScreen: (p: Point2D) => [number, number], scale: number): void
}
