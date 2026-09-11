import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { CompositeCommand } from '../../src/app/commands/CompositeCommand'
import { applyDesignerActions, type DesignerApplyContext } from '../../src/app/designer/actionApplier'
import { stateToActions, type DesignerAction } from '../../src/app/designer/actions'
import { DesignerClient } from '../../src/app/designer/DesignerClient'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Project } from '../../src/core/model/Project'
import { ConstantJudge, DeterministicPicker, TemplateBrain } from '../../services/designer/adapters/fakes'
import { LocalFolderScreenshotStore } from '../../services/designer/adapters/screenshotStore'
import { FileCatalogSource } from '../../services/designer/core/catalogSource'
import { loadRoomState, saveRoomState, emptyRoomState, applyAction } from '../../services/designer/core/roomFile'
import { DesignerSearchClient } from '../../services/designer/core/searchClient'
import { validatePlacement, repairPlacement } from '../../services/designer/core/guardrails'
import { startDesignerServer } from '../../services/designer/server'
import { startSearchServer } from '../../services/search/server'
import { HashingEmbedder } from '../../services/search/adapters/HashingEmbedder'

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'designer-unit-'))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

// ── Aplicador de acciones en el front ────────────────────────────────────

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
    const actions = stateToActions({
      version: 1,
      room: { shape: 'rect', w: 4, d: 3, h: 2.5 },
      openings: [],
      items: [{ uid: 'u1', productId: 'p', x: 1, y: 0, z: 1, rotDeg: 0 }],
    })
    expect(actions[0]!.kind).toBe('setRoom')
    expect(actions[1]!.kind).toBe('placeNew')
  })
})

// ── Cliente WebSocket (Node 22 trae WebSocket nativo) ────────────────────

describe('DesignerClient', () => {
  test('recibe estado al conectar, respuestas de chat y veredictos', async () => {
    const dir = tempDir()
    const catalogIndex = join(dir, 'index.json')
    writeFileSync(
      catalogIndex,
      JSON.stringify([
        {
          id: 'chair-1',
          name: 'Office Chair',
          description: 'office chair',
          price: 90,
          width: 0.6,
          depth: 0.6,
          height: 0.95,
          isSurface: false,
          color: '#fff',
          form: 'box',
          origin: 'test',
          assets: {},
        },
      ]),
    )
    const search = await startSearchServer({ port: 0, embedder: new HashingEmbedder(), dataDir: null })
    await fetch(`http://127.0.0.1:${search.port}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: [{ id: 'chair-1', name: 'Office Chair', description: 'office chair', price: 90 }] }),
    })
    const designer = await startDesignerServer({
      port: 0,
      providers: { brain: new TemplateBrain(), picker: new DeterministicPicker(), judge: new ConstantJudge() },
      roomFile: join(dir, 'room.json'),
      catalogIndex,
      searchUrl: `http://127.0.0.1:${search.port}`,
      screenshots: new LocalFolderScreenshotStore(join(dir, 'shots')),
    })

    const events: string[] = []
    let verdictOverall = 0
    let replies = 0
    const client = await new Promise<DesignerClient>((resolve, reject) => {
      const c: DesignerClient = new DesignerClient(
        {
          onConnection: (connected) => {
            events.push(`conn:${connected}`)
            if (connected) resolve(c)
          },
          onState: () => events.push('state'),
          onReply: () => {
            replies++
            events.push('reply')
          },
          onVerdict: (_id, verdict) => {
            verdictOverall = verdict.overall
            events.push('verdict')
          },
          onError: (error) => events.push(`error:${error}`),
        },
        `ws://127.0.0.1:${designer.port}/ws`,
      )
      setTimeout(() => reject(new Error('timeout de conexión')), 8000)
    })

    try {
      client.chat('añade una office chair')
      client.judge('una silla', `data:image/png;base64,${'b'.repeat(400)}`)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout: ${events.join(',')}`)), 8000)
        const poll = (): void => {
          if (replies >= 1 && verdictOverall > 0) {
            clearTimeout(timer)
            resolve()
          } else setTimeout(poll, 25)
        }
        poll()
      })
      expect(events).toContain('state')
      expect(verdictOverall).toBeGreaterThan(0)
    } finally {
      client.close()
      await designer.close()
      await search.close()
    }
  })
})

// ── Bordes del core del designer ─────────────────────────────────────────

describe('designer core: bordes', () => {
  test('el room file corrupto falla ruidosamente; el ausente es sala vacía', async () => {
    const dir = tempDir()
    const path = join(dir, 'room.json')
    expect((await loadRoomState(path)).items).toEqual([])
    writeFileSync(path, '{corrupto')
    await expect(loadRoomState(path)).rejects.toThrow()
    writeFileSync(path, JSON.stringify({ version: 99 }))
    await expect(loadRoomState(path)).rejects.toThrow(/Versión/)
  })

  test('applyAction rechaza uids desconocidos y persiste el log', async () => {
    const dir = tempDir()
    const state = emptyRoomState()
    applyAction(
      state,
      { kind: 'setRoom', room: { shape: 'rect', w: 4, d: 3, h: 2.5 }, openings: [] },
      { requestId: 'r', source: 'user', at: 'now' },
    )
    expect(() =>
      applyAction(state, { kind: 'move', uid: 'nope', x: 1, z: 1 }, { requestId: 'r', source: 'user', at: 'now' }),
    ).toThrow(/desconocido/)
    const path = join(dir, 'room.json')
    await saveRoomState(path, state)
    expect((await loadRoomState(path)).log).toHaveLength(1)
  })

  test('guardrails: puerta bloqueada y sala llena sin reparación posible', () => {
    const dir = tempDir()
    const catalogIndex = join(dir, 'index.json')
    writeFileSync(
      catalogIndex,
      JSON.stringify([
        {
          id: 'big',
          name: 'Big Thing',
          description: 'big',
          price: 1,
          width: 2.8,
          depth: 2.8,
          height: 2,
          isSurface: false,
          color: '#fff',
          form: 'box',
          origin: 'test',
          assets: {},
        },
      ]),
    )
    const catalog = new FileCatalogSource(catalogIndex)
    expect(catalog.summary()).toContain('Big Thing')
    const state = emptyRoomState()
    state.room = { shape: 'rect', w: 3, d: 3, h: 2.5 }
    state.openings = [{ wall: 'N', kind: 'door', offset: 0.5, width: 0.9 }]

    const item = { uid: 'u1', productId: 'big', x: 1.5, y: 0.4, z: 1.5, rotDeg: 0 }
    const violations = validatePlacement(state, catalog, item)
    expect(violations.map((v) => v.rule)).toContain('floating')
    expect(violations.map((v) => v.rule)).toContain('blocks-door')

    // 2.8 m en una sala de 3 m con puerta: no hay hueco → null.
    expect(repairPlacement(state, catalog, item)).toBeNull()
    expect(validatePlacement(state, catalog, { ...item, productId: 'nope' })[0]!.rule).toBe('unknown-product')
  })

  test('el search client del designer propaga errores HTTP', async () => {
    const client = new DesignerSearchClient('http://127.0.0.1:9', null)
    await expect(client.topCandidates('silla')).rejects.toThrow()
  })
})

describe('DesignSession: intents de edición', () => {
  test('move, rotate y remove operan sobre uids existentes y validan geometría', async () => {
    const dir = tempDir()
    const catalogIndex = join(dir, 'index.json')
    writeFileSync(
      catalogIndex,
      JSON.stringify([
        {
          id: 'chair-1', name: 'Chair', description: 'chair', price: 10,
          width: 0.5, depth: 0.5, height: 0.9,
          isSurface: false, color: '#fff', form: 'box', origin: 'test', assets: {},
        },
      ]),
    )
    const catalog = new FileCatalogSource(catalogIndex)
    const search = await startSearchServer({ port: 0, embedder: new HashingEmbedder(), dataDir: null })
    await fetch(`http://127.0.0.1:${search.port}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: [{ id: 'chair-1', name: 'Chair', description: 'chair', price: 10 }] }),
    })
    const { DesignSession } = await import('../../services/designer/core/DesignSession')
    const { DesignerSearchClient: SC } = await import('../../services/designer/core/searchClient')

    const roomFile = join(dir, 'room.json')
    const makeSession = (intents: unknown[]) =>
      new DesignSession({
        brain: { version: 't', plan: () => Promise.resolve({ reply: 'ok', intents: intents as never }) },
        picker: new DeterministicPicker(),
        judge: new ConstantJudge(),
        search: new SC(`http://127.0.0.1:${search.port}`, catalog),
        catalog,
        filePath: roomFile,
      })

    try {
      await makeSession([
        { kind: 'setRoom', room: { shape: 'rect', w: 4, d: 4, h: 2.5 }, openings: [] },
        { kind: 'placeNew', searchQuery: 'chair', role: 'silla', x: 1, z: 1, rotDeg: 0 },
      ]).chat('setup', 'm1')
      const uid = (await makeSession([]).chat('noop', 'm2')).state.items[0]!.uid

      const moved = await makeSession([
        { kind: 'move', targetUid: uid, x: 2.5, z: 2.5 },
        { kind: 'rotate', targetUid: uid, rotDeg: 90 },
      ]).chat('mueve y gira', 'm3')
      const item = moved.state.items[0]!
      expect(item.x).toBeCloseTo(2.5)
      expect(item.rotDeg).toBe(90)

      // move fuera de la sala: se repara hacia dentro (nunca fuera).
      const outside = await makeSession([{ kind: 'move', targetUid: uid, x: 99, z: 99 }]).chat('fuera', 'm4')
      const repaired = outside.state.items[0]!
      expect(repaired.x).toBeLessThanOrEqual(4)
      expect(repaired.z).toBeLessThanOrEqual(4)

      const removed = await makeSession([{ kind: 'remove', targetUid: uid }]).chat('quita', 'm5')
      expect(removed.state.items).toHaveLength(0)

      // uid inexistente → rechazado con motivo, no excepción.
      const ghost = await makeSession([{ kind: 'remove', targetUid: 'nope' }]).chat('quita otra vez', 'm6')
      expect(ghost.rejected).toHaveLength(1)
    } finally {
      await search.close()
    }
  })

  test('las zonas de aperturas E y W también se respetan', () => {
    const dir = tempDir()
    const catalogIndex = join(dir, 'index.json')
    writeFileSync(
      catalogIndex,
      JSON.stringify([
        {
          id: 'tall', name: 'Tall', description: 'tall', price: 1,
          width: 0.8, depth: 0.4, height: 1.8,
          isSurface: false, color: '#fff', form: 'box', origin: 'test', assets: {},
        },
      ]),
    )
    const catalog = new FileCatalogSource(catalogIndex)
    const state = emptyRoomState()
    state.room = { shape: 'rect', w: 4, d: 4, h: 2.5 }
    state.openings = [
      { wall: 'E', kind: 'window', offset: 1, width: 1 },
      { wall: 'W', kind: 'door', offset: 2, width: 0.9 },
    ]
    const nearEast = { uid: 'a', productId: 'tall', x: 3.7, y: 0, z: 1.5, rotDeg: 0 }
    expect(validatePlacement(state, catalog, nearEast).map((v) => v.rule)).toContain('blocks-window')
    const nearWest = { uid: 'b', productId: 'tall', x: 0.3, y: 0, z: 2.4, rotDeg: 0 }
    expect(validatePlacement(state, catalog, nearWest).map((v) => v.rule)).toContain('blocks-door')
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

describe('Fixes de la review adversarial', () => {
  test('setRoom con muebles existentes emite move/remove explícitos (front y fichero convergen)', async () => {
    const dir = tempDir()
    const catalogIndex = join(dir, 'index.json')
    writeFileSync(
      catalogIndex,
      JSON.stringify([
        {
          id: 'chair-1', name: 'Chair', description: 'chair', price: 10,
          width: 0.5, depth: 0.5, height: 0.9,
          isSurface: false, color: '#fff', form: 'box', origin: 'test', assets: {},
        },
      ]),
    )
    const catalog = new FileCatalogSource(catalogIndex)
    const search = await startSearchServer({ port: 0, embedder: new HashingEmbedder(), dataDir: null })
    await fetch(`http://127.0.0.1:${search.port}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: [{ id: 'chair-1', name: 'Chair', description: 'chair', price: 10 }] }),
    })
    const { DesignSession } = await import('../../services/designer/core/DesignSession')
    const { DesignerSearchClient: SC } = await import('../../services/designer/core/searchClient')
    const roomFile = join(dir, 'room.json')
    const makeSession = (intents: unknown[]) =>
      new DesignSession({
        brain: { version: 't', plan: () => Promise.resolve({ reply: 'ok', intents: intents as never }) },
        picker: new DeterministicPicker(),
        judge: new ConstantJudge(),
        search: new SC(`http://127.0.0.1:${search.port}`, catalog),
        catalog,
        filePath: roomFile,
      })

    try {
      await makeSession([
        { kind: 'setRoom', room: { shape: 'rect', w: 6, d: 6, h: 2.5 }, openings: [] },
        { kind: 'placeNew', searchQuery: 'chair', role: 's1', x: 5.5, z: 5.5, rotDeg: 0 },
        { kind: 'placeNew', searchQuery: 'chair', role: 's2', x: 1, z: 1, rotDeg: 0 },
      ]).chat('dos sillas', 's1')

      // Encoger la sala: la silla en (5.5, 5.5) ya no cabe → move o remove explícito.
      const shrunk = await makeSession([
        { kind: 'setRoom', room: { shape: 'rect', w: 2.5, d: 2.5, h: 2.5 }, openings: [] },
      ]).chat('hazla más pequeña', 's2')

      const followUps = shrunk.actions.filter((a) => a.kind !== 'setRoom')
      expect(followUps.length).toBeGreaterThan(0)
      for (const item of shrunk.state.items) {
        expect(validatePlacement(shrunk.state, catalog, item, item.uid)).toEqual([])
      }
      // El log y el estado del fichero coinciden con lo emitido.
      const reloaded = await loadRoomState(roomFile)
      expect(reloaded.items).toEqual(shrunk.state.items)
    } finally {
      await search.close()
    }
  })

  test('intents con coordenadas ausentes o NaN se rechazan (nunca llegan al fichero)', async () => {
    const dir = tempDir()
    const catalogIndex = join(dir, 'index.json')
    writeFileSync(
      catalogIndex,
      JSON.stringify([
        {
          id: 'chair-1', name: 'Chair', description: 'chair', price: 10,
          width: 0.5, depth: 0.5, height: 0.9,
          isSurface: false, color: '#fff', form: 'box', origin: 'test', assets: {},
        },
      ]),
    )
    const catalog = new FileCatalogSource(catalogIndex)
    const { DesignSession } = await import('../../services/designer/core/DesignSession')
    const { DesignerSearchClient: SC } = await import('../../services/designer/core/searchClient')
    const session = new DesignSession({
      brain: {
        version: 't',
        plan: () =>
          Promise.resolve({
            reply: 'ok',
            intents: [
              { kind: 'setRoom', room: { shape: 'rect', w: 4, d: 4, h: 2.5 }, openings: [] },
              { kind: 'placeNew', searchQuery: 'chair', role: 's', rotDeg: 0 }, // sin x/z
              { kind: 'placeNew', searchQuery: 'chair', role: 's2', x: Number.NaN, z: 1, rotDeg: 0 },
              { kind: 'setRoom', room: { shape: 'rect', w: -3, d: 4, h: 2.5 }, openings: [] },
            ] as never,
          }),
      },
      picker: new DeterministicPicker(),
      judge: new ConstantJudge(),
      search: new SC('http://127.0.0.1:9', catalog),
      catalog,
      filePath: join(dir, 'room.json'),
    })
    const result = await session.chat('x', 'v1')
    expect(result.rejected).toHaveLength(3)
    expect(result.state.items).toHaveLength(0)
    for (const item of result.state.items) expect(Number.isFinite(item.x)).toBe(true)
  })

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
