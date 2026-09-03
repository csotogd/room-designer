import { Point2D } from '../../core/geometry/Point2D'
import { Point3D } from '../../core/geometry/Point3D'
import type { FloorFinish, WallFinish } from '../../core/model/Finishes'
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

export const SCHEMA_VERSION = 2

/** Versiones anteriores que sabemos migrar al cargar. */
const SUPPORTED_VERSIONS = [1, SCHEMA_VERSION]

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

interface FinishesDoc {
  wall: { material: string; color: string }
  floor: { material: string; color: string }
}

export interface ProjectDoc {
  version: number
  ceilingHeight: number
  timeOfDay: number
  walls: WallDoc[]
  furniture: FurnitureDoc[]
  lights: LightDoc[]
  /** Desde la versión 2; los documentos v1 cargan con los acabados por defecto. */
  finishes?: FinishesDoc
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
    finishes: {
      wall: { material: project.wallFinish.material, color: project.wallFinish.color },
      floor: { material: project.floorFinish.material, color: project.floorFinish.color },
    },
  }
}

export function deserializeProject(doc: ProjectDoc, catalog: FurnitureCatalog): Project {
  if (!SUPPORTED_VERSIONS.includes(doc.version)) throw new UnsupportedVersionError(doc.version)

  const plan = new FloorPlan()
  for (const wallDoc of doc.walls ?? []) {
    // Una pared degenerada (inicio = fin, por un doc editado a mano o
    // corrupto) rompería el primer normalize() y con él todo el canvas.
    const start = new Point2D(wallDoc.start.x, wallDoc.start.y)
    const end = new Point2D(wallDoc.end.x, wallDoc.end.y)
    if (start.distanceTo(end) < 1e-6) {
      console.warn(`Pared degenerada descartada al cargar: ${wallDoc.id}`)
      continue
    }
    const wall = new Wall(start, end, wallDoc.thickness, wallDoc.height, wallDoc.id)
    for (const o of wallDoc.openings ?? []) wall.addOpening(restoreOpening(o))
    plan.addWall(wall)
  }

  const project = new Project(plan, doc.ceilingHeight)
  project.setTimeOfDay(doc.timeOfDay)

  const byId = new Map<string, Furniture>()
  for (const f of doc.furniture ?? []) {
    // Un producto retirado del catálogo no puede costarle a quien carga el
    // proyecto entero: se omite ese mueble y el resto sobrevive.
    let item
    try {
      item = catalog.get(f.catalogId)
    } catch {
      console.warn(`Producto ya no disponible en el catálogo, omitido: ${f.catalogId}`)
      continue
    }
    const furniture = new Furniture(
      item,
      new Point3D(f.position.x, f.position.y, f.position.z),
      f.rotationY,
      undefined,
      f.id,
    )
    byId.set(f.id, furniture)
    project.addFurniture(furniture)
  }
  for (const f of doc.furniture ?? []) {
    const furniture = byId.get(f.id)
    if (!furniture || !f.supportedById) continue
    const support = byId.get(f.supportedById)
    if (support) furniture.supportedBy = support
    // Soporte desaparecido: el mueble baja al suelo en vez de flotar.
    else furniture.position = new Point3D(furniture.position.x, 0, furniture.position.z)
  }

  for (const l of doc.lights ?? []) project.addLight(restoreLight(l))

  // v1 no llevaba acabados: se cargan los valores por defecto.
  if (doc.finishes) {
    project.setWallFinish({
      material: doc.finishes.wall.material as WallFinish['material'],
      color: doc.finishes.wall.color,
    })
    project.setFloorFinish({
      material: doc.finishes.floor.material as FloorFinish['material'],
      color: doc.finishes.floor.color,
    })
  }
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
