import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SceneSync, type SceneSyncHost } from '../../src/app/designer/SceneSync'
import { mergeScene, sceneFromState, snapshotProject, reconcileProject } from '../../src/app/designer/scene'
import type { DesignerRoomState, ManualEdit, SceneSnapshot } from '../../src/app/designer/actions'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Door } from '../../src/core/model/Door'
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
})

describe('scene mapping and domain preservation', () => {
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
