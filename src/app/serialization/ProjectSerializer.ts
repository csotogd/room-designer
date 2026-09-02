import { Point2D } from '../../core/geometry/Point2D'
import { Point3D } from '../../core/geometry/Point3D'
import { Door } from '../../core/model/Door'
import { Window } from '../../core/model/Window'
import { Wall } from '../../core/model/Wall'
import { FloorPlan } from '../../core/model/FloorPlan'
import { Furniture } from '../../core/model/Furniture'
import { Project } from '../../core/model/Project'
import {
  CeilingLight,
  FloorLamp,
  WallLight,
  type LightKind,
  type LightPoint,
} from '../../core/model/LightPoint'
import type { OpeningKind } from '../../core/model/Opening'
import type { FurnitureCatalog } from '../catalog/FurnitureCatalog'

export const SCHEMA_VERSION = 1

export class UnsupportedVersionError extends Error {
  constructor(version: unknown) {
    super(`Versión de documento no soportada: ${String(version)} (esperada ${SCHEMA_VERSION})`)
    this.name = 'UnsupportedVersionError'
  }
}

interface Vec3Doc {
  x: number
  y: number
  z: number
}

interface OpeningDoc {
  id: string
  kind: OpeningKind
  offset: number
  width: number
  height: number
  sillHeight: number
}

interface WallDoc {
  id: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  thickness: number
  height: number
  openings: OpeningDoc[]
}

interface FurnitureDoc {
  id: string
  catalogId: string
  position: Vec3Doc
  rotationY: number
  supportedById: string | null
}

interface LightDoc {
  id: string
  kind: LightKind
  position: Vec3Doc
  on: boolean
  intensity: number
  temperatureK: number
}

export interface ProjectDoc {
  version: number
  ceilingHeight: number
  timeOfDay: number
  walls: WallDoc[]
  furniture: FurnitureDoc[]
  lights: LightDoc[]
}

/** JSON no distingue -0 de 0: normalizamos para que el round-trip sea idéntico. */
const num = (value: number): number => (value === 0 ? 0 : value)

export function serializeProject(project: Project): ProjectDoc {
  return {
    version: SCHEMA_VERSION,
    ceilingHeight: num(project.ceilingHeight),
    timeOfDay: num(project.timeOfDay),
    walls: project.floorPlan.walls.map((wall) => ({
      id: wall.id,
      start: { x: num(wall.start.x), y: num(wall.start.y) },
      end: { x: num(wall.end.x), y: num(wall.end.y) },
      thickness: num(wall.thickness),
      height: num(wall.height),
      openings: wall.openings.map((o) => ({
        id: o.id,
        kind: o.kind,
        offset: num(o.offset),
        width: num(o.width),
        height: num(o.height),
        sillHeight: num(o.sillHeight),
      })),
    })),
    furniture: project.furniture.map((f) => ({
      id: f.id,
      catalogId: f.item.id,
      position: { x: num(f.position.x), y: num(f.position.y), z: num(f.position.z) },
      rotationY: num(f.rotationY),
      supportedById: f.supportedBy?.id ?? null,
    })),
    lights: project.lights.map((l) => ({
      id: l.id,
      kind: l.kind,
      position: { x: num(l.position.x), y: num(l.position.y), z: num(l.position.z) },
      on: l.on,
      intensity: num(l.intensity),
      temperatureK: num(l.temperatureK),
    })),
  }
}

export function deserializeProject(doc: ProjectDoc, catalog: FurnitureCatalog): Project {
  if (doc.version !== SCHEMA_VERSION) throw new UnsupportedVersionError(doc.version)

  const plan = new FloorPlan()
  for (const wallDoc of doc.walls) {
    const wall = new Wall(
      new Point2D(wallDoc.start.x, wallDoc.start.y),
      new Point2D(wallDoc.end.x, wallDoc.end.y),
      wallDoc.thickness,
      wallDoc.height,
      wallDoc.id,
    )
    for (const o of wallDoc.openings) wall.addOpening(restoreOpening(o))
    plan.addWall(wall)
  }

  const project = new Project(plan, doc.ceilingHeight)
  project.setTimeOfDay(doc.timeOfDay)

  const byId = new Map<string, Furniture>()
  for (const f of doc.furniture) {
    const furniture = new Furniture(
      catalog.get(f.catalogId),
      new Point3D(f.position.x, f.position.y, f.position.z),
      f.rotationY,
      undefined,
      f.id,
    )
    byId.set(f.id, furniture)
    project.addFurniture(furniture)
  }
  for (const f of doc.furniture) {
    if (f.supportedById) byId.get(f.id)!.supportedBy = byId.get(f.supportedById)
  }

  for (const l of doc.lights) project.addLight(restoreLight(l))
  return project
}

function restoreOpening(doc: OpeningDoc): Door | Window {
  return doc.kind === 'door'
    ? new Door(doc.offset, doc.width, doc.height, doc.id)
    : new Window(doc.offset, doc.width, doc.height, doc.sillHeight, doc.id)
}

function restoreLight(doc: LightDoc): LightPoint {
  const { x, y, z } = doc.position
  const light =
    doc.kind === 'ceiling'
      ? new CeilingLight(x, z, y, doc.id)
      : doc.kind === 'wall'
        ? new WallLight(x, z, y, doc.id)
        : new FloorLamp(x, z, y, doc.id)
  light.on = doc.on
  light.setIntensity(doc.intensity)
  light.setTemperature(doc.temperatureK)
  return light
}
