import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect } from 'vitest'
import WebSocket from 'ws'
import { feature, scenario } from './gherkin'
import { HashingEmbedder } from '../../services/search/adapters/HashingEmbedder'
import { startSearchServer } from '../../services/search/server'
import { ConstantJudge, DeterministicPicker, TemplateBrain } from '../../services/designer/adapters/fakes'
import { FileCatalogSource } from '../../services/designer/core/catalogSource'
import { DesignSession } from '../../services/designer/core/DesignSession'
import { footprint, validatePlacement } from '../../services/designer/core/guardrails'
import { loadRoomState } from '../../services/designer/core/roomFile'
import { DesignerSearchClient } from '../../services/designer/core/searchClient'
import { startDesignerServer } from '../../services/designer/server'
import type { CandidateProduct, DesignAction } from '../../services/designer/core/types'

// ── Fixture: catálogo pequeño pero realista ──────────────────────────────

const CATALOG_FIXTURE = [
  entry('desk-oak', 'Wooden Desk Oak', 'solid oak work desk with drawers', 240, 1.4, 0.7, 0.75),
  entry('desk-pine', 'Painted Wooden Table', 'pine work table, worn paint', 120, 1.2, 0.6, 0.74),
  entry('chair-office-1', 'Office Chair Black', 'swivel office chair with wheels', 90, 0.6, 0.6, 0.95),
  entry('chair-office-2', 'Office Chair Green', 'green upholstered office chair', 110, 0.6, 0.6, 0.92),
  entry('chair-wood', 'Wooden Chair', 'simple wooden chair', 40, 0.45, 0.5, 0.85),
  entry('shelf-1', 'Wooden Bookshelf', 'tall bookshelf shelves for storage', 180, 0.9, 0.35, 1.9),
  entry('plant-1', 'Potted Plant', 'green potted plant decorative', 25, 0.4, 0.4, 1.1),
  entry('bed-1', 'Old Bed Frame', 'metal bed frame vintage', 150, 0.95, 2.0, 0.9),
  entry('wardrobe-1', 'Big Wardrobe', 'tall wooden wardrobe', 400, 1.2, 0.6, 2.1),
  entry('pan-1', 'Brass Pan', 'brass cooking pan with handle', 30, 0.45, 0.2, 0.1),
]

function entry(
  id: string,
  name: string,
  description: string,
  price: number,
  width: number,
  depth: number,
  height: number,
) {
  return {
    id,
    name,
    description,
    price,
    width,
    depth,
    height,
    isSurface: false,
    color: '#fff',
    form: 'box',
    origin: 'test',
    assets: { imageUrl: `/catalog/test/images/${id}.jpg` },
  }
}

// ── Arnés: buscador efímero + sesión con fakes ───────────────────────────

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'designer-'))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

async function harness(options?: { picker?: DeterministicPicker }) {
  const dir = tempDir()
  const indexPath = join(dir, 'index.json')
  writeFileSync(indexPath, JSON.stringify(CATALOG_FIXTURE))

  const search = await startSearchServer({ port: 0, embedder: new HashingEmbedder(), dataDir: null })
  const base = `http://127.0.0.1:${search.port}`
  await fetch(`${base}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      products: CATALOG_FIXTURE.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        price: e.price,
      })),
    }),
  })

  const catalog = new FileCatalogSource(indexPath)
  const roomFile = join(dir, 'room.json')
  const session = new DesignSession({
    brain: new TemplateBrain(),
    picker: options?.picker ?? new DeterministicPicker(),
    judge: new ConstantJudge(),
    search: new DesignerSearchClient(base, catalog),
    catalog,
    filePath: roomFile,
  })
  return { session, catalog, roomFile, indexPath, searchUrl: base, close: () => search.close() }
}

// ── Escenarios ───────────────────────────────────────────────────────────

feature('Conversational room designer', () => {
  scenario('An office brief becomes a furnished room with grounded products', async () => {
    const h = await harness()
    try {
      const result = await h.session.chat('créame una oficina para 4, moderna', 'r1')

      const setRoom = result.actions.filter((a) => a.kind === 'setRoom')
      expect(setRoom).toHaveLength(1)
      const placed = result.actions.filter((a): a is Extract<DesignAction, { kind: 'placeNew' }> => a.kind === 'placeNew')
      // 4 escritorios + 4 sillas como mínimo (estantería/planta pueden caber o no).
      const desks = placed.filter((p) => h.catalog.get(p.productId)!.name.toLowerCase().includes('desk') || h.catalog.get(p.productId)!.name.toLowerCase().includes('table'))
      const chairs = placed.filter((p) => h.catalog.get(p.productId)!.name.toLowerCase().includes('chair'))
      expect(desks.length).toBeGreaterThanOrEqual(4)
      expect(chairs.length).toBeGreaterThanOrEqual(4)

      for (const action of placed) {
        expect(h.catalog.get(action.productId), action.productId).toBeDefined()
        expect(action.query.length).toBeGreaterThan(0)
      }
      // Y todo lo aplicado es geométricamente válido (sin colisiones, dentro).
      for (const item of result.state.items) {
        expect(validatePlacement(result.state, h.catalog, item, item.uid)).toEqual([])
      }
    } finally {
      await h.close()
    }
  })

  scenario("placeNew lets the picker choose among the searcher's top candidates", async () => {
    let seen: CandidateProduct[] = []
    class SpyPicker extends DeterministicPicker {
      override pick(input: { brief: string; query: string; candidates: CandidateProduct[] }) {
        seen = input.candidates
        return super.pick(input)
      }
    }
    const h = await harness({ picker: new SpyPicker() })
    try {
      const result = await h.session.chat('añade una office chair', 'r2')
      const placed = result.actions.find((a) => a.kind === 'placeNew')
      expect(placed).toBeDefined()
      expect(seen.length).toBeGreaterThan(1) // varios candidatos, no solo el primero
      for (const candidate of seen) {
        expect(candidate.price).toBeGreaterThan(0)
        expect(candidate.description.length).toBeGreaterThan(0)
        expect(candidate.imageUrl).toBeDefined()
      }
      expect(seen.map((c) => c.id)).toContain((placed as { productId: string }).productId)
    } finally {
      await h.close()
    }
  })

  scenario('replace swaps the product but keeps the spot', async () => {
    const h = await harness()
    try {
      await h.session.chat('créame una oficina para 1', 'r3')
      const before = await h.session.state()
      const desk = before.items.find((i) => h.catalog.get(i.productId)!.name.toLowerCase().includes('desk'))!

      // Sesión de bajo nivel: replace directo vía intent del cerebro fake no
      // cubre uid concreto, así que usamos el orquestador con un brain ad hoc.
      const result = await new DesignSession({
        brain: {
          version: 'test',
          plan: () =>
            Promise.resolve({
              reply: 'ok',
              intents: [{ kind: 'replace' as const, targetUid: desk.uid, searchQuery: 'painted wooden table', role: 'escritorio' }],
            }),
        },
        picker: new DeterministicPicker(),
        judge: new ConstantJudge(),
        search: new DesignerSearchClient(h.searchUrl, h.catalog),
        catalog: h.catalog,
        filePath: h.roomFile,
      }).chat('cámbiame el escritorio por uno más barato', 'r4')

      const replace = result.actions.find((a) => a.kind === 'replace') as Extract<DesignAction, { kind: 'replace' }>
      expect(replace).toBeDefined()
      expect(replace.uid).toBe(desk.uid)
      expect(replace.productId).not.toBe(desk.productId)
      const after = result.state.items.find((i) => i.uid === desk.uid)!
      // Mismo sitio (la reparación solo se mueve si las medidas nuevas no caben).
      expect(Math.abs(after.x - desk.x)).toBeLessThan(0.6)
      expect(Math.abs(after.z - desk.z)).toBeLessThan(0.6)
    } finally {
      await h.close()
    }
  })

  scenario('Nothing lands outside the room, floating, or colliding', async () => {
    const h = await harness()
    try {
      const result = await new DesignSession({
        brain: {
          version: 'test',
          plan: () =>
            Promise.resolve({
              reply: 'ok',
              intents: [
                {
                  kind: 'setRoom' as const,
                  room: { shape: 'rect' as const, w: 3, d: 3, h: 2.5 },
                  openings: [],
                },
                // Fuera de la habitación: los guardrails deben recolocarla dentro.
                { kind: 'placeNew' as const, searchQuery: 'wooden chair', role: 'silla', x: 10, z: 10, rotDeg: 0 },
                // Encima de la anterior: reparación por colisión.
                { kind: 'placeNew' as const, searchQuery: 'wooden chair', role: 'silla 2', x: 2.9, z: 2.9, rotDeg: 0 },
              ],
            }),
        },
        picker: new DeterministicPicker(),
        judge: new ConstantJudge(),
        search: new DesignerSearchClient(h.searchUrl, h.catalog),
        catalog: h.catalog,
        filePath: h.roomFile,
      }).chat('dos sillas', 'r5')

      for (const item of result.state.items) {
        expect(item.y).toBe(0)
        const violations = validatePlacement(result.state, h.catalog, item, item.uid)
        expect(violations, JSON.stringify(violations)).toEqual([])
      }
    } finally {
      await h.close()
    }
  })

  scenario('Furniture never blocks a window or a door swing', async () => {
    const h = await harness()
    try {
      const result = await new DesignSession({
        brain: {
          version: 'test',
          plan: () =>
            Promise.resolve({
              reply: 'ok',
              intents: [
                {
                  kind: 'setRoom' as const,
                  room: { shape: 'rect' as const, w: 4, d: 3, h: 2.5 },
                  openings: [
                    { wall: 'N' as const, kind: 'window' as const, offset: 1, width: 1.5 },
                    { wall: 'S' as const, kind: 'door' as const, offset: 0.2, width: 0.9 },
                  ],
                },
                // Armario de 2.1 m plantado delante de la ventana.
                { kind: 'placeNew' as const, searchQuery: 'big wardrobe', role: 'armario', x: 1.7, z: 0.35, rotDeg: 0 },
              ],
            }),
        },
        picker: new DeterministicPicker(),
        judge: new ConstantJudge(),
        search: new DesignerSearchClient(h.searchUrl, h.catalog),
        catalog: h.catalog,
        filePath: h.roomFile,
      }).chat('un armario', 'r6')

      const wardrobe = result.state.items.find((i) => i.productId === 'wardrobe-1')
      if (wardrobe) {
        // Si cupo, es porque la reparación lo sacó de la zona de la ventana.
        const product = h.catalog.get(wardrobe.productId)!
        const box = footprint(wardrobe, product.width, product.depth)
        const windowZone = { minX: 1, maxX: 2.5, minZ: 0, maxZ: 0.75 }
        const intersects =
          box.minX < windowZone.maxX && box.maxX > windowZone.minX && box.minZ < windowZone.maxZ && box.maxZ > windowZone.minZ
        expect(intersects).toBe(false)
      } else {
        // O se rechazó explícitamente — nunca se aplica en silencio.
        expect(result.rejected.length).toBeGreaterThan(0)
      }
    } finally {
      await h.close()
    }
  })

  scenario('The room file records the state and the full action log', async () => {
    const h = await harness()
    try {
      const result = await h.session.chat('créame una oficina para 2', 'r7')
      const reloaded = await loadRoomState(h.roomFile)

      expect(reloaded.room).toEqual(result.state.room)
      expect(reloaded.items).toEqual(result.state.items)
      expect(reloaded.log.length).toBe(result.actions.length)
      for (const entry of reloaded.log) {
        expect(entry.requestId).toBe('r7')
        expect(entry.source).toBe('assistant')
        expect(entry.at).toMatch(/^\d{4}-/)
      }
      for (const item of reloaded.items) {
        expect(typeof item.x).toBe('number')
        expect(typeof item.y).toBe('number')
        expect(typeof item.z).toBe('number')
      }
    } finally {
      await h.close()
    }
  })

  scenario('The websocket serves chat, state and the judge', async () => {
    const dir = tempDir()
    const indexPath = join(dir, 'index.json')
    writeFileSync(indexPath, JSON.stringify(CATALOG_FIXTURE))
    const search = await startSearchServer({ port: 0, embedder: new HashingEmbedder(), dataDir: null })
    const base = `http://127.0.0.1:${search.port}`
    await fetch(`${base}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products: CATALOG_FIXTURE.map((e) => ({ id: e.id, name: e.name, description: e.description, price: e.price })),
      }),
    })

    const designer = await startDesignerServer({
      port: 0,
      providers: { brain: new TemplateBrain(), picker: new DeterministicPicker(), judge: new ConstantJudge() },
      roomFile: join(dir, 'room.json'),
      catalogIndex: indexPath,
      searchUrl: base,
    })

    try {
      const socket = new WebSocket(`ws://127.0.0.1:${designer.port}/ws`)
      const messages: Record<string, unknown>[] = []
      const waitFor = (type: string): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`timeout esperando ${type}`)), 10_000)
          const check = (): void => {
            const found = messages.find((m) => m.type === type)
            if (found) {
              clearTimeout(timer)
              resolve(found)
            } else setTimeout(check, 20)
          }
          check()
        })
      socket.on('message', (raw: Buffer) => messages.push(JSON.parse(raw.toString()) as Record<string, unknown>))
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })

      await waitFor('state') // estado inicial al conectar

      socket.send(JSON.stringify({ type: 'chat', requestId: 'ws1', text: 'créame una oficina para 2' }))
      const reply = await waitFor('reply')
      expect((reply.actions as unknown[]).length).toBeGreaterThan(0)
      expect((reply.state as { items: unknown[] }).items.length).toBeGreaterThan(0)

      socket.send(
        JSON.stringify({
          type: 'judge',
          requestId: 'ws2',
          brief: 'oficina para 2',
          image: `data:image/png;base64,${'a'.repeat(500)}`,
        }),
      )
      const judged = await waitFor('judge.result')
      const verdict = judged.verdict as { cohesion: number; adherence: number }
      expect(verdict.cohesion).toBeGreaterThan(0)
      expect(verdict.adherence).toBeGreaterThan(0)

      socket.close()
    } finally {
      await designer.close()
      await search.close()
    }
  })

  scenario('The judge scores the rubric dimensions from a screenshot', async () => {
    const judge = new ConstantJudge()
    const verdict = await judge.judge({
      brief: 'oficina moderna para 4',
      screenshotPngBase64: 'x'.repeat(2000),
    })
    for (const key of ['cohesion', 'colors', 'style', 'adherence', 'overall'] as const) {
      expect(verdict[key]).toBeGreaterThanOrEqual(1)
      expect(verdict[key]).toBeLessThanOrEqual(10)
    }
    expect(verdict.notes.length).toBeGreaterThan(0)
  })
})
