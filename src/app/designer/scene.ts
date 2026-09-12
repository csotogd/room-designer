/** Browser/domain boundary for the scene shared with Python. No transport or UI state. */
import { Point3D } from '../../core/geometry/Point3D'
import { DEFAULT_FLOOR_FINISH, DEFAULT_WALL_FINISH } from '../../core/model/Finishes'
import { Furniture } from '../../core/model/Furniture'
import type { Project } from '../../core/model/Project'
import type { FurnitureCatalog } from '../catalog/FurnitureCatalog'
import { deserializeProject, serializeProject, type ProjectDoc } from '../serialization/ProjectSerializer'
import type { DesignerOpening, DesignerRoomState, SceneSnapshot } from './actions'

const copy = <T>(value: T): T => structuredClone(value)
const n = (value: number) => Math.round(value * 1e9) / 1e9
export function equal(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
    return value
  }
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

export function sceneFromState(state: Pick<DesignerRoomState, 'room' | 'items' | 'openings' | 'environment'>): SceneSnapshot {
  return {
    room: state.room ? { shape: 'rect', w: n(state.room.w), d: n(state.room.d), h: n(state.room.h) } : null,
    openings: state.openings.map((o) => ({ wall: o.wall, kind: o.kind, offset: n(o.offset), width: n(o.width),
      height: n(o.height ?? (o.kind === 'door' ? 2 : 1.1)), sillHeight: n(o.sillHeight ?? (o.kind === 'door' ? 0 : .9)) }))
      .sort((a, b) => a.wall.localeCompare(b.wall) || a.offset - b.offset),
    items: state.items.map((i) => ({ uid: i.uid, productId: i.productId, x: n(i.x), y: n(i.y), z: n(i.z),
      rotDeg: n(((i.rotDeg % 360) + 360) % 360), supportedBy: i.supportedBy ?? null })).sort((a, b) => a.uid.localeCompare(b.uid)),
    environment: copy(state.environment ?? { timeOfDay: 12, lights: [],
      finishes: { wall: DEFAULT_WALL_FINISH, floor: DEFAULT_FLOOR_FINISH } }),
  }
}

export function snapshotProject(project: Project): SceneSnapshot {
  const doc = serializeProject(project)
  const vertices = project.floorPlan.floorPolygon()?.vertices
  const width = Math.max(...doc.walls.flatMap((w) => [w.start.x, w.end.x]))
  const depth = Math.max(...doc.walls.flatMap((w) => [w.start.y, w.end.y]))
  if (vertices?.length !== 4 || doc.walls.length !== 4 || !doc.walls.every((w) =>
    ((w.start.x === 0 && w.end.x === 0) || (w.start.x === width && w.end.x === width)
      || (w.start.y === 0 && w.end.y === 0) || (w.start.y === depth && w.end.y === depth)))) {
    throw new Error('El agente todavía necesita una habitación rectangular. Tu plano manual se conserva; no iniciaré un turno sobre otro plano.')
  }
  const openings: DesignerOpening[] = doc.walls.flatMap((w) => {
    const wall = w.start.y === w.end.y ? (w.start.y === 0 ? 'N' : 'S') : (w.start.x === 0 ? 'W' : 'E')
    const start = wall === 'N' || wall === 'S' ? w.start.x : w.start.y
    const end = wall === 'N' || wall === 'S' ? w.end.x : w.end.y
    return w.openings.map((o) => ({ wall, kind: o.kind, width: o.width, height: o.height, sillHeight: o.sillHeight,
      offset: end > start ? start + o.offset : start - o.offset - o.width }))
  })
  return sceneFromState({ room: { shape: 'rect', w: width, d: depth, h: doc.ceilingHeight }, openings,
    items: doc.furniture.map((f) => ({ uid: f.id, productId: f.catalogId, x: f.position.x, y: f.position.y,
      z: f.position.z, rotDeg: f.rotationY * 180 / Math.PI, supportedBy: f.supportedById })),
    environment: { timeOfDay: doc.timeOfDay, lights: doc.lights, finishes: doc.finishes! },
  })
}

/** Overlay edits made after a send, while retaining independent updates from the server. */
export function mergeScene(base: SceneSnapshot, local: SceneSnapshot, remote: SceneSnapshot, force = false): SceneSnapshot {
  const merge = <T>(b: T, a: T, c: T): T => {
    if (equal(a, b) || equal(a, c)) return copy(c)
    if (equal(c, b) || force) return copy(a)
    throw new Error('La habitación cambió mientras editabas. Elige qué versión conservar.')
  }
  const entities = <T>(b: T[], a: T[], c: T[], id: (item: T) => string): T[] => {
    const [before, after, current] = [b, a, c].map((rows) => new Map(rows.map((i) => [id(i), i])))
    return [...new Set([...before!.keys(), ...after!.keys(), ...current!.keys()])].sort()
      .map((key) => merge(before!.get(key) ?? null, after!.get(key) ?? null, current!.get(key) ?? null))
      .filter((item) => item !== null)
  }
  const layoutChanged = (a: SceneSnapshot, b: SceneSnapshot) => !equal(a.room, b.room) || !equal(a.openings, b.openings)
  if ((layoutChanged(base, local) && !equal(remote, base) && !equal(local, remote))
    || (layoutChanged(base, remote) && !equal(local, base) && !equal(local, remote))) {
    if (force) return copy(local)
    throw new Error('El plano cambió mientras editabas. Elige qué versión conservar.')
  }
  return { room: merge(base.room, local.room, remote.room), openings: merge(base.openings, local.openings, remote.openings),
    items: entities(base.items, local.items, remote.items, (i) => i.uid), environment: {
      timeOfDay: merge(base.environment.timeOfDay, local.environment.timeOfDay, remote.environment.timeOfDay),
      lights: entities(base.environment.lights, local.environment.lights, remote.environment.lights, (l) => l.id),
      finishes: { wall: merge(base.environment.finishes.wall, local.environment.finishes.wall, remote.environment.finishes.wall),
        floor: merge(base.environment.finishes.floor, local.environment.finishes.floor, remote.environment.finishes.floor) },
    } }
}

/** Reconcile in place so selection, drag targets and existing undo commands retain their object identities. */
export function reconcileProject(project: Project, scene: SceneSnapshot, catalog: FurnitureCatalog): void {
  const present = new Map(project.furniture.map((f) => [f.id, f]))
  const wanted = new Map(scene.items.map((i) => [i.uid, i]))
  for (const furniture of project.furniture.slice()) {
    const next = wanted.get(furniture.id)
    if (!next || next.productId !== furniture.item.id) { project.removeFurniture(furniture); present.delete(furniture.id) }
  }
  for (const item of scene.items) {
    let furniture = present.get(item.uid)
    if (!furniture) {
      furniture = new Furniture(catalog.get(item.productId), new Point3D(item.x, item.y, item.z), 0, undefined, item.uid)
      project.addFurniture(furniture)
      present.set(item.uid, furniture)
    }
    furniture.position = new Point3D(item.x, item.y, item.z)
    furniture.rotationY = item.rotDeg * Math.PI / 180
  }
  for (const item of scene.items) present.get(item.uid)!.supportedBy = present.get(item.supportedBy ?? '')
  // The existing serializer restores light/finish classes with the same validation as saved projects.
  const environmentDoc: ProjectDoc = { ...serializeProject(project), ...scene.environment, furniture: [] }
  const environment = deserializeProject(environmentDoc, catalog)
  for (const light of project.lights.slice()) {
    if (!environment.lights.some((l) => l.id === light.id && l.kind === light.kind)) project.removeLight(light)
  }
  for (const light of environment.lights) {
    const existing = project.lights.find((l) => l.id === light.id)
    if (!existing) project.addLight(light)
    else project.updateLight(existing, (l) => {
      l.position = light.position; l.on = light.on; l.intensity = light.intensity; l.temperatureK = light.temperatureK
    })
  }
  project.setTimeOfDay(scene.environment.timeOfDay)
  project.setWallFinish(environment.wallFinish)
  project.setFloorFinish(environment.floorFinish)
  project.events.emit('changed', { kind: 'furniture-moved' })
}
