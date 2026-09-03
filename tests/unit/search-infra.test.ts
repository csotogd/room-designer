import { describe, expect, test, vi, afterEach } from 'vitest'
import { SearchClient, rankLocally } from '../../src/app/search/SearchClient'
import { syncSearchIndex, toSearchProducts } from '../../pipeline/core/searchSync'
import { HashingEmbedder } from '../../services/search/adapters/HashingEmbedder'
import { evaluateHits } from '../../services/search/core/evaluation'
import { Logger } from '../../services/search/core/logger'
import { Metrics } from '../../services/search/core/metrics'
import { VectorIndex } from '../../services/search/core/VectorIndex'
import { startSearchServer } from '../../services/search/server'
import { Product } from '../../src/core/model/Product'

const item = (id: string, name: string, description = ''): Product =>
  new Product({
    id,
    name,
    description,
    width: 1,
    depth: 1,
    height: 1,
    price: 100,
    isSurface: false,
    color: '#fff',
    form: 'box',
  })

describe('VectorIndex: bordes del ciclo de vida', () => {
  test('borrar una fila intermedia compacta y el resto sigue encontrable', () => {
    const index = new VectorIndex(4, 2) // capacidad pequeña: fuerza grow()
    index.upsert('a', Float32Array.from([1, 0, 0, 0]))
    index.upsert('b', Float32Array.from([0, 1, 0, 0]))
    index.upsert('c', Float32Array.from([0, 0, 1, 0]))
    index.remove('b')
    index.remove('desconocido') // no-op
    expect(index.size).toBe(2)
    expect(index.has('b')).toBe(false)
    expect(index.search(Float32Array.from([0, 0, 1, 0]), 1)[0]!.id).toBe('c')
    expect(index.search(Float32Array.from([1, 0, 0, 0]), 1)[0]!.id).toBe('a')
  })

  test('reemplazar un vector existente no duplica la fila', () => {
    const index = new VectorIndex(2)
    index.upsert('a', Float32Array.from([1, 0]))
    index.upsert('a', Float32Array.from([0, 1]))
    expect(index.size).toBe(1)
    expect(index.search(Float32Array.from([0, 1]), 1)[0]!.score).toBeCloseTo(1)
  })

  test('la dimensión equivocada es un error, no corrupción silenciosa', () => {
    const index = new VectorIndex(4)
    expect(() => index.upsert('a', Float32Array.from([1, 0]))).toThrow(/dims/)
  })
})

describe('Evaluación IR: casos límite', () => {
  test('sin relevantes esperados, recall y ndcg valen 1 (no hay nada que fallar)', () => {
    const result = evaluateHits([{ id: 'x', score: 1 }], [], 5)
    expect(result.recallAtK).toBe(1)
    expect(result.ndcgAtK).toBe(1)
    expect(result.reciprocalRank).toBe(0)
  })

  test('relevante fuera del top-k puntúa 0', () => {
    const hits = [
      { id: 'a', score: 3 },
      { id: 'b', score: 2 },
    ]
    const result = evaluateHits(hits, ['zzz'], 2)
    expect(result.recallAtK).toBe(0)
    expect(result.reciprocalRank).toBe(0)
  })
})

describe('Logger estructurado', () => {
  afterEach(() => vi.restoreAllMocks())

  test('emite JSON por línea con el contexto heredado del child', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const log = new Logger('test', {}, 'debug').child({ requestId: 'r1' })
    log.debug('hola', { extra: 1 })
    log.warn('ojo')
    log.error('mal')
    const first = JSON.parse((out.mock.calls[0]![0] as string).trim()) as Record<string, unknown>
    expect(first).toMatchObject({ level: 'debug', service: 'test', msg: 'hola', requestId: 'r1', extra: 1 })
    expect(out).toHaveBeenCalledTimes(2) // debug + warn
    expect(err).toHaveBeenCalledTimes(1) // error va a stderr
  })

  test('el umbral filtra niveles inferiores y silent no emite nada', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    new Logger('test', {}, 'warn').info('invisible')
    new Logger('test', {}, 'silent').error('tampoco')
    expect(out).not.toHaveBeenCalled()
    expect(err).not.toHaveBeenCalled()
  })
})

describe('Métricas del servicio', () => {
  test('acumula latencias por ruta y cuenta errores 5xx', () => {
    const metrics = new Metrics()
    metrics.observeRequest('GET /search', 200, 10)
    metrics.observeRequest('GET /search', 500, 30)
    const snapshot = metrics.snapshot() as { routes: Record<string, { count: number; errors: number; avgMs: number; maxMs: number }> }
    expect(snapshot.routes['GET /search']).toMatchObject({ count: 2, errors: 1, avgMs: 20, maxMs: 30 })
  })

  test('las señales de calidad separan vacías, dudosas y buenas', () => {
    const metrics = new Metrics()
    metrics.observeSearchQuality(null)
    metrics.observeSearchQuality(0.1)
    metrics.observeSearchQuality(0.9)
    metrics.observeSyncError('boom')
    const snapshot = metrics.snapshot() as {
      searchQuality: { searches: number; emptyRate: number; lowConfidenceRate: number }
      lastSyncError: { detail: string }
    }
    expect(snapshot.searchQuality).toMatchObject({ searches: 3 })
    expect(snapshot.searchQuality.emptyRate).toBeCloseTo(1 / 3)
    expect(snapshot.searchQuality.lowConfidenceRate).toBeCloseTo(1 / 3)
    expect(snapshot.lastSyncError.detail).toBe('boom')
  })
})

describe('SearchClient del front', () => {
  test('rankLocally puntúa nombre sobre descripción y normaliza acentos', () => {
    const products = [
      item('a', 'Silla de roble', 'asiento de tela'),
      item('b', 'Mesa lacada', 'patas de róble macizo'),
      item('c', 'Lámpara', 'de pie'),
    ]
    const scores = rankLocally('roble', products)
    expect(scores.get('a')!).toBeGreaterThan(scores.get('b')!)
    expect(scores.has('c')).toBe(false)
    expect(rankLocally('  ', products).size).toBe(0)
  })

  test('rank consulta el servicio y devuelve null si no está disponible', async () => {
    const server = await startSearchServer({ port: 0, embedder: new HashingEmbedder(), dataDir: null })
    try {
      const base = `http://127.0.0.1:${server.port}`
      await fetch(`${base}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: [{ id: 'p1', name: 'Silla de roble', description: 'silla', price: 100 }],
        }),
      })
      const scores = await new SearchClient(base).rank('silla de roble')
      expect(scores?.get('p1')).toBeGreaterThan(0)

      const down = await new SearchClient('http://127.0.0.1:9').rank('silla')
      expect(down).toBeNull()
    } finally {
      await server.close()
    }
  })
})

describe('Sync del pipeline contra el servicio', () => {
  test('empuja la instantánea, propaga el runId y reporta el resultado', async () => {
    const server = await startSearchServer({
      port: 0,
      embedder: new HashingEmbedder(),
      dataDir: null,
      syncToken: 'secreto',
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const products = toSearchProducts(
        [
          {
            id: 'p1',
            name: 'Silla',
            description: 'de roble',
            width: 0.5,
            depth: 0.5,
            height: 0.8,
            price: 99,
            isSurface: false,
            color: '#fff',
            form: 'box',
            origin: 'sklum',
            assets: { imageUrl: '/catalog/x/images/p1.jpg' },
          },
        ],
        'https://cdn.example.com',
      )
      const ok = await syncSearchIndex(products, base, 'secreto', 'run-42')
      expect(ok.ok).toBe(true)
      expect(ok.detail).toContain('+1')

      const unauthorized = await syncSearchIndex(products, base, 'incorrecto')
      expect(unauthorized.ok).toBe(false)
      expect(unauthorized.detail).toContain('401')

      const unreachable = await syncSearchIndex(products, 'http://127.0.0.1:9')
      expect(unreachable.ok).toBe(false)
    } finally {
      await server.close()
    }
  })
})