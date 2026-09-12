import { Point3D } from '../../core/geometry/Point3D'
import { Furniture } from '../../core/model/Furniture'
import { FloorPlan } from '../../core/model/FloorPlan'
import { Door } from '../../core/model/Door'
import { Window } from '../../core/model/Window'
import type { Project } from '../../core/model/Project'
import type { Command } from '../commands/Command'
import { CompositeCommand } from '../commands/CompositeCommand'
import { RemoveFurnitureCommand } from '../commands/RemoveFurnitureCommand'
import type { CommandStack } from '../commands/CommandStack'
import type { FurnitureCatalog } from '../catalog/FurnitureCatalog'
import type { DesignerAction, DesignerOpening, DesignerRoomSpec } from './actions'

/**
 * Aplica las acciones del diseñador al dominio. setRoom recrea el proyecto
 * (vía el callback de la App); el resto se agrupa en un CompositeCommand:
 * un turno de chat = una entrada de undo.
 */
export interface DesignerApplyContext {
  project(): Project
  catalog: FurnitureCatalog
  stack: CommandStack
  replaceRoom(plan: FloorPlan, height: number): void
}

export interface ApplyReport {
  applied: number
  skipped: { action: DesignerAction; reason: string }[]
}

export function applyDesignerActions(
  ctx: DesignerApplyContext,
  actions: readonly DesignerAction[],
): ApplyReport {
  const skipped: ApplyReport['skipped'] = []
  let applied = 0
  let commands: Command[] = []
  // Los uids se validan contra el estado FUTURO del lote (un move puede
  // referirse a un placeNew del mismo turno); la resolución real de cada
  // Furniture ocurre al ejecutar, nunca al construir el comando.
  const uids = new Set(ctx.project().furniture.map((f) => f.id))

  const flush = (): void => {
    if (commands.length === 0) return
    ctx.stack.execute(new CompositeCommand(commands))
    commands = []
  }

  for (const action of actions) {
    try {
      if (action.kind === 'setRoom') {
        // Los comandos previos del turno se ejecutan ANTES sobre su proyecto
        // (capturaron ese Project); recrear la habitación reinicia el
        // historial y el resto del turno sigue sobre la nueva.
        flush()
        const plan = buildPlan(action.room, action.openings, skipped, action)
        ctx.replaceRoom(plan, action.room.h)
        uids.clear()
        for (const f of ctx.project().furniture) uids.add(f.id)
        applied++
        continue
      }
      // Construir primero (puede lanzar); el bookkeeping de uids va después
      // para que un fallo no deje registrado un uid que nunca se colocó.
      const command = toCommand(ctx, action)
      if (action.kind === 'placeNew') {
        if (uids.has(action.uid)) throw new Error(`uid duplicado: ${action.uid}`)
        uids.add(action.uid)
      } else if (!uids.has(action.uid)) {
        throw new Error(`uid desconocido en la escena: ${action.uid}`)
      }
      if (action.kind === 'remove') uids.delete(action.uid)

      commands.push(command)
      applied++
    } catch (error) {
      skipped.push({ action, reason: String(error) })
    }
  }

  flush()
  return { applied, skipped }
}

function buildPlan(
  room: DesignerRoomSpec,
  openings: DesignerOpening[],
  skipped: ApplyReport['skipped'],
  action: DesignerAction,
): FloorPlan {
  const plan = FloorPlan.rectangle(room.w, room.d, room.h)
  // rectangle(): walls[0]=N (0,0→w,0), [1]=E, [2]=S (w,d→0,d), [3]=W (0,d→0,0).
  const wallIndex = { N: 0, E: 1, S: 2, W: 3 } as const
  for (const opening of openings) {
    const wall = plan.walls[wallIndex[opening.wall]]
    if (!wall) continue
    // El servicio mide offsets desde el extremo oeste/norte; las paredes S y
    // W recorren en sentido contrario, así que se convierte al del muro.
    const along =
      opening.wall === 'S'
        ? room.w - opening.offset - opening.width
        : opening.wall === 'W'
          ? room.d - opening.offset - opening.width
          : opening.offset
    const piece =
      opening.kind === 'door' ? new Door(along, opening.width, opening.height)
        : new Window(along, opening.width, opening.height, opening.sillHeight)
    if (wall.canPlaceOpening(piece, along)) {
      wall.addOpening(piece)
    } else {
      // Nada de descartes silenciosos: la apertura que no cabe se reporta.
      skipped.push({
        action,
        reason: `apertura ${opening.kind} en pared ${opening.wall} (offset ${opening.offset}) no cabe`,
      })
    }
  }
  return plan
}

/**
 * Comandos con resolución PEREZOSA: el Furniture del uid y su estado previo
 * se capturan al ejecutar (no al construir), porque dentro de un mismo turno
 * un move/rotate puede referirse a un mueble que coloca una acción anterior.
 */
function toCommand(ctx: DesignerApplyContext, action: Exclude<DesignerAction, { kind: 'setRoom' }>): Command {
  const project = ctx.project()
  switch (action.kind) {
    case 'placeNew': {
      const item = ctx.catalog.get(action.productId) // lanza si no existe
      const furniture = new Furniture(
        item,
        new Point3D(action.x, action.y ?? 0, action.z),
        degToRad(action.rotDeg),
        undefined,
        action.uid,
      )
      return {
        execute: () => project.addFurniture(furniture),
        undo: () => project.removeFurniture(furniture),
      }
    }
    case 'replace': {
      const item = ctx.catalog.get(action.productId)
      const replacement = new Furniture(
        item,
        new Point3D(action.x, action.y ?? 0, action.z),
        degToRad(action.rotDeg),
        undefined,
        action.uid,
      )
      let remove: RemoveFurnitureCommand | null = null
      return {
        execute: () => {
          const previous = findByUid(project, action.uid)
          replacement.position = new Point3D(action.x, action.y ?? previous.position.y, action.z)
          remove = new RemoveFurnitureCommand(project, previous)
          remove.execute()
          project.addFurniture(replacement)
        },
        undo: () => {
          project.removeFurniture(replacement)
          remove?.undo()
        },
      }
    }
    case 'move': {
      let furniture: Furniture | null = null
      let fromX = 0
      let fromY = 0
      let fromZ = 0
      return {
        execute: () => {
          furniture = findByUid(project, action.uid)
          fromX = furniture.position.x
          fromY = furniture.position.y
          fromZ = furniture.position.z
          project.moveFurniture(furniture, action.x, action.z, action.y)
        },
        undo: () => {
          if (furniture) project.moveFurniture(furniture, fromX, fromZ, fromY)
        },
      }
    }
    case 'rotate': {
      let furniture: Furniture | null = null
      let from = 0
      return {
        execute: () => {
          furniture = findByUid(project, action.uid)
          from = furniture.rotationY
          project.rotateFurniture(furniture, degToRad(action.rotDeg))
        },
        undo: () => {
          if (furniture) project.rotateFurniture(furniture, from)
        },
      }
    }
    case 'remove': {
      let remove: RemoveFurnitureCommand | null = null
      return {
        execute: () => {
          remove = new RemoveFurnitureCommand(project, findByUid(project, action.uid))
          remove.execute()
        },
        undo: () => remove?.undo(),
      }
    }
  }
}

function findByUid(project: Project, uid: string): Furniture {
  const found = project.furniture.find((f) => f.id === uid)
  if (!found) throw new Error(`uid desconocido en la escena: ${uid}`)
  return found
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}
