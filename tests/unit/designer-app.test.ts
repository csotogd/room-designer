import { describe, expect, test } from 'vitest'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { CompositeCommand } from '../../src/app/commands/CompositeCommand'
import { applyDesignerActions, type DesignerApplyContext } from '../../src/app/designer/actionApplier'
import { stateToActions, type DesignerAction } from '../../src/app/designer/actions'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Project } from '../../src/core/model/Project'
import { reconcileProject, snapshotProject } from '../../src/app/designer/scene'

function appContext() {
  const catalog = new DefaultCatalog()
  const stack = new CommandStack()
  let project = new Project(FloorPlan.rectangle(5, 4, 2.6))
  const replaced: { w: number; h: number }[] = []
  const ctx: DesignerApplyContext = {
    project: () => project,
    catalog,
    stack,
    replaceRoom: (plan, height) => {
      replaced.push({ w: plan.walls.length, h: height })
      project = new Project(plan, height)
      stack.clear()
    },
  }
  return { ctx, catalog, stack, project: () => project, replaced }
}

describe('applyDesignerActions', () => {
  test('setRoom recrea la habitación con sus aperturas', () => {
    const { ctx, replaced, project } = appContext()
    const report = applyDesignerActions(ctx, [
      {
        kind: 'setRoom',
        room: { shape: 'rect', w: 6, d: 5, h: 2.7 },
        openings: [
          { wall: 'N', kind: 'window', offset: 1, width: 1.2 },
          { wall: 'S', kind: 'door', offset: 0.5, width: 0.9 },
        ],
      },
    ])
    expect(report.applied).toBe(1)
    expect(replaced).toEqual([{ w: 4, h: 2.7 }])
    const openings = project().floorPlan.walls.flatMap((w) => w.openings)
    expect(openings).toHaveLength(2)
  })

  test('un turno entero es UNA entrada de undo (composite)', () => {
    const { ctx, stack, project, catalog } = appContext()
    const item = catalog.items()[0]!
    const actions: DesignerAction[] = [
      { kind: 'placeNew', uid: 'u1', productId: item.id, x: 1, z: 1, rotDeg: 0, query: 'q' },
      { kind: 'placeNew', uid: 'u2', productId: item.id, x: 3, z: 2, rotDeg: 90, query: 'q' },
      { kind: 'move', uid: 'u1', x: 2, z: 1.5 },
    ]
    const report = applyDesignerActions(ctx, actions)
    expect(report.applied).toBe(3)
    expect(project().furniture).toHaveLength(2)
    expect(project().furniture.find((f) => f.id === 'u1')!.position.x).toBe(2)

    stack.undo() // un solo undo revierte el turno completo
    expect(project().furniture).toHaveLength(0)
    stack.redo()
    expect(project().furniture).toHaveLength(2)
  })

  test('replace conserva el uid y cambia el producto; remove y rotate operan por uid', () => {
    const { ctx, project, catalog } = appContext()
    const [a, b] = catalog.items()
    applyDesignerActions(ctx, [
      { kind: 'placeNew', uid: 'u1', productId: a!.id, x: 1, z: 1, rotDeg: 0, query: 'q' },
    ])
    applyDesignerActions(ctx, [
      { kind: 'replace', uid: 'u1', productId: b!.id, x: 1, z: 1, rotDeg: 45, query: 'q' },
      { kind: 'rotate', uid: 'u1', rotDeg: 90 },
    ])
    const replacedItem = project().furniture.find((f) => f.id === 'u1')!
    expect(replacedItem.item.id).toBe(b!.id)
    expect(replacedItem.rotationY).toBeCloseTo(Math.PI / 2)

    applyDesignerActions(ctx, [{ kind: 'remove', uid: 'u1' }])
    expect(project().furniture).toHaveLength(0)
  })

  test('acciones inválidas se saltan con motivo, sin romper el turno', () => {
    const { ctx, project, catalog } = appContext()
    const item = catalog.items()[0]!
    const report = applyDesignerActions(ctx, [
      { kind: 'placeNew', uid: 'u1', productId: 'producto-fantasma', x: 1, z: 1, rotDeg: 0, query: 'q' },
      { kind: 'move', uid: 'uid-fantasma', x: 1, z: 1 },
      { kind: 'placeNew', uid: 'u2', productId: item.id, x: 2, z: 2, rotDeg: 0, query: 'q' },
    ])
    expect(report.applied).toBe(1)
    expect(report.skipped).toHaveLength(2)
    expect(project().furniture).toHaveLength(1)
  })

  test('stateToActions reconstruye una sala completa', () => {
    const { ctx, project, catalog } = appContext()
    const actions = stateToActions({
      version: 1,
      room: { shape: 'rect', w: 4, d: 3, h: 2.5 },
      openings: [],
      items: [{ uid: 'u1', productId: catalog.items()[0]!.id, x: 1, y: 1.2, z: 1, rotDeg: 0 }],
    })
    expect(actions[0]!.kind).toBe('setRoom')
    expect(actions[1]!.kind).toBe('placeNew')
    expect(applyDesignerActions(ctx, actions).skipped).toEqual([])
    expect(project().furniture[0]!.position.y).toBe(1.2)
  })

  test('altura 3D se conserva al mover, reemplazar, deshacer y rehacer', () => {
    const { ctx, stack, project, catalog } = appContext()
    const [a, b] = catalog.items()
    applyDesignerActions(ctx, [
      { kind: 'placeNew', uid: 'u1', productId: a!.id, x: 1, y: 0.75, z: 1, rotDeg: 0, query: '' },
    ])
    applyDesignerActions(ctx, [
      { kind: 'move', uid: 'u1', x: 2, y: 1.2, z: 2 },
      { kind: 'replace', uid: 'u1', productId: b!.id, x: 2, z: 2, rotDeg: 0, query: '' },
      { kind: 'move', uid: 'u1', x: 3, z: 2 },
      { kind: 'rotate', uid: 'u1', rotDeg: 90 },
    ])
    expect(project().furniture[0]!.position).toMatchObject({ x: 3, y: 1.2, z: 2 })
    stack.undo()
    expect(project().furniture[0]!.position).toMatchObject({ x: 1, y: 0.75, z: 1 })
    expect(project().furniture[0]!.item.id).toBe(a!.id)
    stack.redo()
    expect(project().furniture[0]!.position).toMatchObject({ x: 3, y: 1.2, z: 2 })
    expect(project().furniture[0]!.item.id).toBe(b!.id)
    applyDesignerActions(ctx, [{ kind: 'move', uid: 'u1', x: 3, y: 0, z: 2 }])
    expect(project().furniture[0]!.position.y).toBe(0)
    stack.undo()
    expect(project().furniture[0]!.position.y).toBe(1.2)
  })

  test('replace aplica la altura explícita y la sincronización la restaura', () => {
    const { ctx, project, catalog } = appContext()
    const [a, b] = catalog.items()
    applyDesignerActions(ctx, [
      { kind: 'placeNew', uid: 'u1', productId: a!.id, x: 1, y: 0.75, z: 1, rotDeg: 0, query: '' },
      { kind: 'replace', uid: 'u1', productId: b!.id, x: 1, y: 1.2, z: 1, rotDeg: 0, query: '' },
    ])
    const scene = snapshotProject(project())
    expect(scene.items[0]!.y).toBe(1.2)
    const restored = new Project(FloorPlan.rectangle(5, 4, 2.6))
    reconcileProject(restored, scene, catalog)
    expect(restored.furniture[0]!.position.y).toBe(1.2)
    expect(snapshotProject(restored)).toEqual(scene)
  })
})


describe('applyDesignerActions: undo simétrico y aperturas E/W', () => {
  test('undo revierte replace, move, rotate y remove en orden inverso', () => {
    const { ctx, stack, project, catalog } = appContext()
    const [a, b] = catalog.items()
    applyDesignerActions(ctx, [
      { kind: 'placeNew', uid: 'u1', productId: a!.id, x: 1, z: 1, rotDeg: 0, query: 'q' },
      { kind: 'placeNew', uid: 'u2', productId: a!.id, x: 3, z: 3, rotDeg: 0, query: 'q' },
    ])
    applyDesignerActions(ctx, [
      { kind: 'replace', uid: 'u1', productId: b!.id, x: 1.5, z: 1, rotDeg: 90, query: 'q' },
      { kind: 'move', uid: 'u2', x: 2, z: 2.5 },
      { kind: 'rotate', uid: 'u2', rotDeg: 180 },
      { kind: 'remove', uid: 'u1' },
    ])
    expect(project().furniture).toHaveLength(1)

    stack.undo() // deshace el segundo turno entero
    const u1 = project().furniture.find((f) => f.id === 'u1')!
    const u2 = project().furniture.find((f) => f.id === 'u2')!
    expect(u1.item.id).toBe(a!.id) // replace revertido al producto original
    expect(u1.position.x).toBe(1)
    expect(u2.position.x).toBe(3) // move revertido
    expect(u2.position.z).toBe(3)
    expect(u2.rotationY).toBe(0) // rotate revertido

    stack.redo()
    expect(project().furniture).toHaveLength(1)
    expect(project().furniture[0]!.id).toBe('u2')
    expect(project().furniture[0]!.position.z).toBe(2.5)
  })

  test('uid duplicado en placeNew se salta; aperturas E y W se colocan en su pared', () => {
    const { ctx, project, catalog } = appContext()
    const item = catalog.items()[0]!
    const report = applyDesignerActions(ctx, [
      {
        kind: 'setRoom',
        room: { shape: 'rect', w: 6, d: 5, h: 2.6 },
        openings: [
          { wall: 'E', kind: 'window', offset: 1, width: 1.2 },
          { wall: 'W', kind: 'door', offset: 2, width: 0.9 },
        ],
      },
      { kind: 'placeNew', uid: 'dup', productId: item.id, x: 1, z: 1, rotDeg: 0, query: 'q' },
      { kind: 'placeNew', uid: 'dup', productId: item.id, x: 2, z: 2, rotDeg: 0, query: 'q' },
    ])
    expect(report.skipped).toHaveLength(1)
    expect(report.skipped[0]!.reason).toMatch(/duplicado/)
    expect(project().furniture).toHaveLength(1)

    // E = pared x=w (índice 1), W = pared x=0 (índice 3); offsets convertidos
    // al sentido de recorrido de cada muro.
    const walls = project().floorPlan.walls
    expect(walls[1]!.openings).toHaveLength(1)
    expect(walls[1]!.openings[0]!.offset).toBe(1)
    expect(walls[3]!.openings).toHaveLength(1)
    expect(walls[3]!.openings[0]!.offset).toBeCloseTo(5 - 2 - 0.9)
  })
})


describe('Composite rollback', () => {
  test('un fallo a mitad de composite revierte el prefijo (sin mutación huérfana)', () => {
    const { ctx, stack, project, catalog } = appContext()
    const item = catalog.items()[0]!
    // remove de u2 con u2 colocado por la MISMA tanda pero placeNew inválido:
    // el composite ejecuta placeNew(u1) y explota en el remove — debe revertir.
    const boom = {
      execute: () => {
        throw new Error('boom')
      },
      undo: () => {},
    }
    const place = {
      executed: 0,
      undone: 0,
      execute() {
        this.executed++
        ctx.project().placeFurniture(item, 1, 1)
      },
      undo() {
        this.undone++
        ctx.project().removeFurniture(ctx.project().furniture[ctx.project().furniture.length - 1]!)
      },
    }
    const composite = new CompositeCommand([place, boom])
    expect(() => stack.execute(composite)).toThrow('boom')
    expect(place.executed).toBe(1)
    expect(place.undone).toBe(1)
    expect(project().furniture).toHaveLength(0)
    expect(stack.canUndo()).toBe(false) // nada a medio aplicar en el historial
  })
})
