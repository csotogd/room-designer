import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SceneSync, type SceneSyncHost } from '../../src/app/designer/SceneSync'
import { equal, mergeScene, sceneFromState, snapshotProject, reconcileProject } from '../../src/app/designer/scene'
import type { DesignerRoomState, ManualEdit, SceneSnapshot } from '../../src/app/designer/actions'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Door } from '../../src/core/model/Door'
import { Window } from '../../src/core/model/Window'
import { Point2D } from '../../src/core/geometry/Point2D'
import { CeilingLight } from '../../src/core/model/LightPoint'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { MoveFurnitureCommand } from '../../src/app/commands/FurnitureCommands'

const initial = (): DesignerRoomState => ({ version: 1, revision: 'v0', room: { shape: 'rect', w: 6, d: 5, h: 2.6 },
  openings: [], items: [
    { uid: 'a', productId: 'desk', x: 1, y: 0, z: 1, rotDeg: 0 },
    { uid: 'b', productId: 'chair', x: 4, y: 0, z: 3, rotDeg: 0 },
  ] })
const state = (scene: SceneSnapshot, revision: string): DesignerRoomState => ({ version: 1, revision, ...scene })
const clone = <T>(value: T): T => structuredClone(value)
function storage(): Storage {
  const values = new Map<string, string>()
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k) } as unknown as Storage
}
function setup(store = storage()) {
  let scene = sceneFromState(initial())
  const sends: ManualEdit[] = []
  const host: SceneSyncHost = { snapshot: () => clone(scene), apply: vi.fn((value) => { scene = clone(value) }),
    send: (edit) => sends.push(clone(edit)), status: vi.fn(), saved: vi.fn() }
  const sync = new SceneSync(host, store)
  sync.connection(true)
  sync.receive(initial())
  const move = (x: number) => { scene.items[0]!.x = x; sync.changed() }
  const ack = (edit: ManualEdit, revision: string, merged = edit.desired) => sync.result({ type: 'edit.result',
    requestId: edit.requestId, state: state(merged, revision) })
  return { sync, host, sends, store, move, ack, scene: () => scene }
}
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('manual edit delivery and reconciliation', () => {
  test('disconnected edits stay local, reject waiting chat, then save after state recovery', async () => {
    const h = setup()
    h.sync.connection(false)
    h.move(2.4)
    await vi.advanceTimersByTimeAsync(500)
    expect(h.sends).toEqual([])
    expect(h.sync.hasPending).toBe(true)
    expect(h.host.status).toHaveBeenLastCalledWith('Cambios pendientes', false)
    await expect(h.sync.flush()).rejects.toThrow('conecte')
    h.sync.connection(true)
    await expect(h.sync.flush()).rejects.toThrow('conecte')
    h.sync.receive(initial())
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0]!.desired.items[0]!.x).toBe(2.4)
    const waiting = h.sync.flush()
    h.sync.connection(false)
    await expect(waiting).rejects.toThrow('Sin conexión')
    expect(h.host.status).toHaveBeenLastCalledWith('Cambios pendientes · sin conexión', false)
    await vi.advanceTimersByTimeAsync(16000)
    expect(h.host.status).toHaveBeenLastCalledWith('Cambios pendientes · sin conexión', false)
  })

  test('a rejected edit retains the draft and a corrected edit can be saved', async () => {
    const h = setup()
    h.move(2)
    const waiting = h.sync.flush()
    expect(h.sync.error('unrelated', 'otro error')).toBe(false)
    expect(h.sync.error(undefined, 'otro error')).toBe(false)
    expect(h.sync.error(h.sends[0]!.requestId, 'Revisa la posición')).toBe(true)
    await expect(waiting).rejects.toThrow('Revisa la posición')
    expect(h.store.getItem('room-designer:manual-draft')).not.toBeNull()
    await vi.advanceTimersByTimeAsync(16000)
    expect(h.sends).toHaveLength(1)
    await expect(h.sync.flush()).rejects.toThrow('Revisa la posición')
    h.move(2.5)
    const corrected = h.sync.flush()
    expect(h.sends).toHaveLength(2)
    expect(h.sends[1]!.requestId).not.toBe(h.sends[0]!.requestId)
    h.ack(h.sends[0]!, 'old')
    expect(h.sync.hasPending).toBe(true)
    h.ack(h.sends[1]!, 'v1')
    await corrected
    expect(h.sync.hasPending).toBe(false)
    expect(h.host.status).toHaveBeenLastCalledWith('Habitación guardada', false)
  })

  test('a clean client follows the latest broadcast including its revision and saved callback', async () => {
    const h = setup()
    const remote = sceneFromState(initial())
    remote.items[1]!.x = 3.6
    const latest = state(remote, 'other-tab')
    h.sync.receive(latest)
    expect(h.scene()).toEqual(remote)
    expect(h.sync.currentRevision).toBe('other-tab')
    expect(h.host.saved).toHaveBeenLastCalledWith(latest)
    expect(h.sync.hasPending).toBe(false)
    await h.sync.flush()
    expect(h.sends).toEqual([])
  })

  test('initial local content is retained when the shared room is empty', async () => {
    const sends: ManualEdit[] = []
    const local = sceneFromState(initial())
    const sync = new SceneSync({ snapshot: () => local, apply: vi.fn(), saved: vi.fn(), status: vi.fn(),
      send: (edit) => sends.push(edit) })
    sync.connection(true)
    sync.receive({ version: 1, room: null, items: [], openings: [] })
    expect(sync.currentRevision).toBe('initial')
    expect(sends).toHaveLength(1)
    expect(sends[0]!.base.room).toBeNull()
    expect(sends[0]!.baseRevision).toBeNull()
    expect(sends[0]!.desired).toEqual(local)
    sync.result({ type: 'edit.result', requestId: sends[0]!.requestId, state: state(local, 'created') })
    await sync.flush()
    expect(sync.hasPending).toBe(false)
  })

  test('sends one final drag and blocks agent submission until its acknowledgement', async () => {
    const h = setup()
    h.sync.beginGesture()
    h.move(2)
    await vi.advanceTimersByTimeAsync(400)
    h.move(3)
    await vi.advanceTimersByTimeAsync(400)
    expect(h.sends).toHaveLength(0)
    await expect(h.sync.flush()).rejects.toThrow('Termina el arrastre')
    h.sync.endGesture()
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0]!.desired.items[0]!.x).toBe(3)
    let ready = false
    const flushed = h.sync.flush().then(() => { ready = true })
    await Promise.resolve()
    expect(ready).toBe(false)
    h.ack(h.sends[0]!, 'v1')
    await flushed
    expect(ready).toBe(true)
    expect(h.sync.currentRevision).toBe('v1')
  })

  test('queues newer local changes while preserving independent server updates in the ACK', async () => {
    const h = setup()
    h.move(2)
    await vi.advanceTimersByTimeAsync(250)
    const first = h.sends[0]!
    h.sync.beginGesture()
    h.move(3)
    const merged = clone(first.desired)
    merged.items[1]!.z = 4
    h.ack(first, 'v1', merged)
    expect(h.scene().items[0]!.x).toBe(3)
    expect(h.scene().items[1]!.z).toBe(3) // no jump during an active drag
    h.sync.endGesture()
    expect(h.scene().items[1]!.z).toBe(4)
    expect(h.sends).toHaveLength(2)
    expect(h.sends[1]!.baseRevision).toBe('v1')
    expect(h.sends[1]!.desired.items[0]!.x).toBe(3)
    expect(h.sends[1]!.desired.items[1]!.z).toBe(4)
    h.ack(h.sends[1]!, 'v2')
    expect(h.sync.hasPending).toBe(false)
  })

  test('a broadcast during a drag does not move the object or replace the original base', () => {
    const h = setup()
    h.sync.beginGesture()
    const remote = sceneFromState(initial())
    remote.items[0]!.x = 4
    h.sync.receive(state(remote, 'remote'))
    h.move(2)
    h.sync.endGesture()
    expect(h.scene().items[0]!.x).toBe(2)
    expect(h.sends[0]!.baseRevision).toBe('v0')
    expect(h.sends[0]!.base.items[0]!.x).toBe(1)
  })

  test('edits made after a send conflict visibly when a retry ACK contains a newer move of that object', async () => {
    const h = setup()
    h.move(2)
    await vi.advanceTimersByTimeAsync(250)
    h.move(3)
    const remote = clone(h.sends[0]!.desired)
    remote.items[0]!.x = 4
    remote.items[1]!.z = 4.2
    h.ack(h.sends[0]!, 'latest', remote)
    expect(h.host.status).toHaveBeenLastCalledWith(expect.stringContaining('Elige'), true)
    expect(h.scene().items[0]!.x).toBe(3)
    await expect(h.sync.flush()).rejects.toThrow('Elige')
    h.sync.resolve(true)
    expect(h.sends[1]!.baseRevision).toBe('latest')
    expect(h.sends[1]!.desired.items.map((i) => [i.x, i.z])).toEqual([[3, 1], [4, 4.2]])
    h.ack(h.sends[1]!, 'resolved')
    await h.sync.flush()
  })

  test('lost ACKs and reloads replay the same request id and restore the visible draft', async () => {
    const h = setup()
    h.move(2)
    await vi.advanceTimersByTimeAsync(250)
    const sent = h.sends[0]!
    h.sync.connection(false)
    const reloaded = setup(h.store)
    expect(reloaded.scene().items[0]!.x).toBe(2)
    expect(reloaded.sends).toEqual([sent])
    reloaded.ack(sent, 'v1')
    expect(reloaded.sync.hasPending).toBe(false)
    expect(h.store.getItem('room-designer:manual-draft')).toBeNull()
  })

  test.each([true, false])('same-object conflict waits for an explicit choice: keep local=%s', async (keep) => {
    const h = setup()
    h.move(2)
    await vi.advanceTimersByTimeAsync(250)
    const remote = sceneFromState(initial())
    remote.items[0]!.x = 3
    remote.items[1]!.z = 4
    h.sync.result({ type: 'edit.conflict', requestId: h.sends[0]!.requestId, state: state(remote, 'v1'), conflicts: ['mueble:a'] })
    await expect(h.sync.flush()).rejects.toThrow('simultáneos')
    expect(h.sends).toHaveLength(1)
    h.sync.resolve(keep)
    expect(h.scene().items[0]!.x).toBe(keep ? 2 : 3)
    expect(h.scene().items[1]!.z).toBe(4)
    expect(h.sends).toHaveLength(keep ? 2 : 1)
    if (keep) {
      expect(h.sends[1]!.requestId).not.toBe(h.sends[0]!.requestId)
      h.ack(h.sends[1]!, 'v2')
    }
  })

  test('a missing acknowledgement fails the waiting chat and a retry keeps the same request id', async () => {
    const h = setup()
    h.move(2)
    const waiting = expect(h.sync.flush()).rejects.toThrow('No se ha confirmado')
    await vi.advanceTimersByTimeAsync(15001)
    await waiting
    const retry = h.sync.flush()
    expect(h.sends).toHaveLength(2)
    expect(h.sends[1]!.requestId).toBe(h.sends[0]!.requestId)
    h.ack(h.sends[1]!, 'v1')
    await retry
  })

  test('invalid local plans block the agent without overwriting the local view', async () => {
    const h = setup()
    h.host.snapshot = () => { throw new Error('plano no soportado') }
    h.sync.changed()
    vi.mocked(h.host.apply).mockClear()
    h.sync.receive({ ...initial(), revision: 'v1' })
    await expect(h.sync.flush()).rejects.toThrow('plano no soportado')
    expect(h.host.apply).not.toHaveBeenCalled()
    expect(h.sends).toHaveLength(0)
  })

  test('an unsupported saved plan also blocks the first turn before any new local edit', async () => {
    const apply = vi.fn()
    const send = vi.fn()
    const sync = new SceneSync({ snapshot: () => { throw new Error('plano no soportado') },
      apply, send, status: vi.fn(), saved: vi.fn() })
    sync.connection(true)
    expect(() => sync.receive(initial(), true)).not.toThrow()
    await expect(sync.flush()).rejects.toThrow('plano no soportado')
    expect(apply).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('scene mapping and domain preservation', () => {
  test('a shared scene restores every furniture and light attribute, additions, replacements and removals', () => {
    const catalog = new DefaultCatalog()
    const project = new Project(FloorPlan.rectangle(6, 5, 2.6), 2.6)
    const replaced = project.placeFurniture(catalog.get('chair'), 1, 1)
    const removed = project.placeFurniture(catalog.get('sofa'), 3, 3)
    const retained = project.placeFurniture(catalog.get('table'), 2, 2)
    const lamp = new CeilingLight(1, 1, 2.6, 'retained')
    project.addLight(lamp)
    project.addLight(new CeilingLight(2, 1, 2.6, 'removed'))
    project.addLight(new CeilingLight(3, 1, 2.6, 'replaced'))
    const desired = sceneFromState({ room: { shape: 'rect', w: 6, d: 5, h: 2.6 }, openings: [], items: [
      { uid: replaced.id, productId: 'desk', x: 1.25, y: .2, z: 1.8, rotDeg: 270 },
      { uid: retained.id, productId: 'table', x: 3.1, y: .4, z: 2.7, rotDeg: 45 },
      { uid: 'vase', productId: 'vase', x: 3.2, y: 1.15, z: 2.8, rotDeg: 30, supportedBy: retained.id },
    ], environment: { timeOfDay: 19.25, finishes: { wall: { material: 'brick', color: '#cbaa98' },
      floor: { material: 'carpet', color: '#554433' } }, lights: [
      { id: 'retained', kind: 'ceiling', position: { x: 4, y: 2.4, z: 3 }, on: false, intensity: .35, temperatureK: 2900 },
      { id: 'replaced', kind: 'wall', position: { x: 0, y: 1.8, z: 2 }, on: true, intensity: .7, temperatureK: 5500 },
      { id: 'added', kind: 'floor', position: { x: 5, y: 1.6, z: 4 }, on: false, intensity: .5, temperatureK: 3500 },
    ] } })
    const changed = vi.fn()
    project.events.on('changed', changed)
    reconcileProject(project, desired, catalog)
    expect(snapshotProject(project)).toEqual(desired)
    expect(project.furniture).not.toContain(removed)
    expect(project.furniture).not.toContain(replaced)
    expect(project.furniture).toContain(retained)
    expect(project.furniture.find((f) => f.id === 'vase')!.supportedBy).toBe(retained)
    expect(project.lights).toContain(lamp)
    expect(changed).toHaveBeenCalledWith({ kind: 'furniture-moved' })
    desired.items[2]!.x = 0
    desired.environment.finishes.wall = { material: 'paint', color: '#000000' }
    expect(project.wallFinish.color).toBe('#cbaa98')
  })

  test.each([false, true])('maps openings on all walls regardless of traversal direction: reversed=%s', (reversed) => {
    const corners = [new Point2D(0, 0), new Point2D(6, 0), new Point2D(6, 5), new Point2D(0, 5)]
    const project = new Project(FloorPlan.fromCorners(reversed ? corners.reverse() : corners, 2.7), 2.7)
    for (const wall of project.floorPlan.walls) {
      project.addOpening(wall, new Door(.3, .8, 2.1))
      project.addOpening(wall, new Window(1.7, 1.2, .85, 1.1))
    }
    const snapshot = snapshotProject(project)
    expect(snapshot.room).toEqual({ shape: 'rect', w: 6, d: 5, h: 2.7 })
    const forward = new Set(reversed ? ['S', 'W'] : ['N', 'E'])
    const openings = ['E', 'N', 'S', 'W'].flatMap((wall) => {
      const length = wall === 'N' || wall === 'S' ? 6 : 5
      return [
        { wall, kind: 'door', offset: forward.has(wall) ? .3 : length - 1.1, width: .8, height: 2.1, sillHeight: 0 },
        { wall, kind: 'window', offset: forward.has(wall) ? 1.7 : length - 2.9, width: 1.2, height: .85, sillHeight: 1.1 },
      ].sort((a, b) => a.offset - b.offset)
    })
    expect(snapshot.openings).toEqual(openings)
  })

  test('canonicalization removes metadata and normalizes precision, ordering and legacy defaults', () => {
    const result = sceneFromState({ room: { shape: 'rect', w: 5.1234567894, d: 4.1234567894, h: 2.6234567894 },
      items: [{ uid: 'z', productId: 'chair', x: 1.1234567894, y: .1234567894, z: 2.1234567894, rotDeg: -90 },
        { uid: 'a', productId: 'desk', x: 2, y: 0, z: 2, rotDeg: 405 }],
      openings: [{ wall: 'W', kind: 'window', offset: .1234567894, width: 1.1234567894 },
        { wall: 'N', kind: 'door', offset: 0, width: .8 }] })
    expect(result).toEqual({ room: { shape: 'rect', w: 5.123456789, d: 4.123456789, h: 2.623456789 },
      items: [{ uid: 'a', productId: 'desk', x: 2, y: 0, z: 2, rotDeg: 45, supportedBy: null },
        { uid: 'z', productId: 'chair', x: 1.123456789, y: .123456789, z: 2.123456789, rotDeg: 270, supportedBy: null }],
      openings: [{ wall: 'N', kind: 'door', offset: 0, width: .8, height: 2, sillHeight: 0 },
        { wall: 'W', kind: 'window', offset: .123456789, width: 1.123456789, height: 1.1, sillHeight: .9 }],
      environment: { timeOfDay: 12, lights: [], finishes: { wall: { material: 'paint', color: '#f2eee4' },
        floor: { material: 'wood', color: '#d9c5a3' } } } })
  })

  test('merges additions, deletions and independent finish edits without aliasing inputs', () => {
    const base = sceneFromState(initial())
    const local = clone(base)
    const remote = clone(base)
    local.items = [local.items[0]!]
    local.environment.finishes.wall = { material: 'brick', color: '#aabbcc' }
    remote.items.push({ ...remote.items[1]!, uid: 'c', z: 4 })
    remote.environment.finishes.floor = { material: 'tiles', color: '#112233' }
    const merged = mergeScene(base, local, remote)
    expect(merged.items.map((i) => i.uid)).toEqual(['a', 'c'])
    expect(merged.environment.finishes).toEqual({ wall: local.environment.finishes.wall, floor: remote.environment.finishes.floor })
    merged.items[0]!.x = 5
    expect(base.items[0]!.x).toBe(1)
    expect(remote.items[0]!.x).toBe(1)
    remote.items[1]!.x = 3
    expect(() => mergeScene(base, local, remote)).toThrow('Elige')
    expect(mergeScene(base, local, remote, true).items.map((i) => i.uid)).toEqual(['a', 'c'])
  })

  test('combines independent light changes and detects competing edits to the same light', () => {
    const base = sceneFromState(initial())
    const light = { id: 'a', kind: 'floor' as const, position: { x: 1, y: 1.5, z: 1 },
      on: true, intensity: 1, temperatureK: 4000 }
    base.environment.lights = [light, { ...clone(light), id: 'b' }]
    const local = clone(base)
    const remote = clone(base)
    local.environment.lights[0]!.on = false
    remote.environment.lights[1]!.position.x = 4
    remote.environment.lights.push({ ...clone(light), id: 'c', intensity: .5 })
    remote.environment.timeOfDay = 17
    const merged = mergeScene(base, local, remote)
    expect(merged.environment.lights).toEqual([local.environment.lights[0], ...remote.environment.lights.slice(1)])
    expect(merged.environment.timeOfDay).toBe(17)
    remote.environment.lights[0]!.intensity = .2
    expect(() => mergeScene(base, local, remote)).toThrow('Elige')
    expect(mergeScene(base, local, remote, true).environment.lights[0]).toEqual(local.environment.lights[0])
  })

  test('a layout conflict requires an explicit choice while matching layout edits are idempotent', () => {
    const base = sceneFromState(initial())
    const local = clone(base)
    const remote = clone(base)
    local.room!.w = 7
    remote.items[0]!.x = 2
    expect(() => mergeScene(base, local, remote)).toThrow('plano')
    expect(() => mergeScene(base, remote, local)).toThrow('plano')
    expect(mergeScene(base, local, remote, true)).toEqual(local)
    expect(mergeScene(base, local, local)).toEqual(local)
    expect(mergeScene(base, base, local)).toEqual(local)
    const openingEdit = clone(base)
    openingEdit.openings.push({ wall: 'N', kind: 'door', offset: .3, width: .8, height: 2, sillHeight: 0 })
    expect(() => mergeScene(base, openingEdit, remote)).toThrow('plano')
  })

  test('equality ignores object key order but distinguishes reordered arrays and null values', () => {
    expect(equal({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true)
    expect(equal([1, 2], [2, 1])).toBe(false)
    expect(equal(null, {})).toBe(false)
    expect(equal({ a: undefined }, { a: null })).toBe(false)
  })
  test('keeps height, supports, southern opening offsets, finishes and lighting', () => {
    const catalog = new DefaultCatalog()
    const project = new Project(FloorPlan.rectangle(6, 5, 2.6), 2.6)
    const table = project.placeFurniture(catalog.items().find((i) => i.isSurface)!, 2, 2)
    const top = project.placeOnTop(catalog.items()[0]!, table)
    project.addOpening(project.floorPlan.walls[2]!, new Door(.5, .9, 2.1))
    project.addLight(new CeilingLight(2, 2, 2.6, 'lamp'))
    project.setTimeOfDay(18)
    const snapshot = snapshotProject(project)
    expect(snapshot.items.find((i) => i.uid === top.id)!.supportedBy).toBe(table.id)
    expect(snapshot.items.find((i) => i.uid === top.id)!.y).toBe(table.topY())
    expect(snapshot.openings[0]!.offset).toBe(4.6)
    expect(snapshot.openings[0]!.height).toBe(2.1)
    expect(snapshot.environment.timeOfDay).toBe(18)
    expect(snapshot.environment.lights[0]!.id).toBe('lamp')
  })

  test('reconciliation retains furniture and light identities used by selection and undo', () => {
    const catalog = new DefaultCatalog()
    const project = new Project(FloorPlan.rectangle(6, 5, 2.6), 2.6)
    const furniture = project.placeFurniture(catalog.items()[0]!, 1, 1)
    const lamp = new CeilingLight(2, 2, 2.6)
    project.addLight(lamp)
    const stack = new CommandStack()
    stack.execute(new MoveFurnitureCommand(project, furniture, 2, 2))
    const desired = snapshotProject(project)
    desired.environment.timeOfDay = 16
    reconcileProject(project, desired, catalog)
    expect(project.furniture[0]).toBe(furniture)
    expect(project.lights[0]).toBe(lamp)
    stack.undo()
    expect(project.furniture[0]!.position.x).toBe(1)
  })

  test('does not pretend an L-shaped room is a rectangle', () => {
    const project = new Project(FloorPlan.lShape(6, 5, 2, 2))
    expect(() => snapshotProject(project)).toThrow('rectangular')
  })

  test('compares maps without depending on JSON key insertion order', () => {
    const base = sceneFromState(initial())
    const remote = { environment: base.environment, items: base.items, openings: base.openings, room: base.room }
    expect(mergeScene(base, base, remote)).toEqual(base)
  })
})
