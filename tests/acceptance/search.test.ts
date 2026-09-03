import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { FileSnapshotStore } from '../../services/search/adapters/FileSnapshotStore'
import { HashingEmbedder } from '../../services/search/adapters/HashingEmbedder'
import { evaluateSearch } from '../../services/search/core/evaluation'
import { Metrics } from '../../services/search/core/metrics'
import { SearchIndexService } from '../../services/search/core/SearchIndexService'
import { VectorIndex } from '../../services/search/core/VectorIndex'
import { startSearchServer } from '../../services/search/server'
import { toSearchProducts } from '../../pipeline/core/searchSync'
import type { SearchProduct } from '../../services/search/core/types'

const SOFA: SearchProduct = {
  id: 'sklum-sofa-terracota',
  name: 'Sofá de 3 plazas en terciopelo terracota',
  description: 'Sofá tapizado en terciopelo, patas de madera maciza · 220×90×80 cm',
  price: 899,
  imageUrl: 'https://cdn.example.com/sofa.jpg',
}
const CHAIR: SearchProduct = {
  id: 'sklum-silla-roble',
  name: 'Silla de comedor en madera de roble',
  description: 'Silla nórdica de roble con asiento de bouclé · 46×53×80 cm',
  price: 120,
  imageUrl: 'https://cdn.example.com/silla.jpg',
}
const LAMP: SearchProduct = {
  id: 'sklum-lampara-arco',
  name: 'Lámpara de pie en arco dorada',
  description: 'Lámpara de salón con base de mármol · 35×180 cm',
  price: 210,
}

/** Embedder que cuenta llamadas, para verificar idempotencia y re-embebidos. */
class CountingEmbedder extends HashingEmbedder {
  embedded: string[] = []

  override embedProducts(products: readonly SearchProduct[]): Promise<Float32Array[]> {
    this.embedded.push(...products.map((p) => p.id))
    return super.embedProducts(products)
  }
}

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'search-index-'))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

feature('Semantic catalog search', () => {
  scenario('A product is indexed as one embedding of photo, description and price', async () => {
    const embedder = new HashingEmbedder()
    const service = new SearchIndexService(embedder)
    const report = await service.sync([SOFA])
    expect(report).toMatchObject({ added: 1, updated: 0, removed: 0, unchanged: 0, total: 1 })
    expect(service.size).toBe(1)
    // El hash de contenido cubre foto, descripción y precio: cambiar
    // cualquiera de los tres produce un vector (y un hash) distinto.
    expect(service.contentHash(SOFA)).not.toBe(service.contentHash({ ...SOFA, price: 100 }))
    expect(service.contentHash(SOFA)).not.toBe(
      service.contentHash({ ...SOFA, imageUrl: 'https://cdn.example.com/otra.jpg' }),
    )
  })

  scenario('Catalog sync is idempotent', async () => {
    const embedder = new CountingEmbedder()
    const service = new SearchIndexService(embedder)
    await service.sync([SOFA, CHAIR, LAMP])
    expect(embedder.embedded).toHaveLength(3)

    const again = await service.sync([SOFA, CHAIR, LAMP])
    expect(again).toMatchObject({ added: 0, updated: 0, removed: 0, unchanged: 3, total: 3 })
    expect(embedder.embedded).toHaveLength(3)
  })

  scenario('Catalog refresh adds new embeddings and removes stale ones', async () => {
    const service = new SearchIndexService(new HashingEmbedder())
    await service.sync([SOFA, CHAIR])

    const report = await service.sync([CHAIR, LAMP])
    expect(report).toMatchObject({ added: 1, removed: 1, unchanged: 1, total: 2 })

    const hits = await service.search('lámpara de arco dorada', 5)
    expect(hits[0]!.id).toBe(LAMP.id)
    expect(hits.map((h) => h.id)).not.toContain(SOFA.id)
  })

  scenario('Unchanged products are not re-embedded on refresh', async () => {
    const embedder = new CountingEmbedder()
    const service = new SearchIndexService(embedder)
    await service.sync([SOFA, CHAIR, LAMP])
    embedder.embedded = []

    await service.sync([SOFA, { ...CHAIR, price: 99 }, LAMP])
    expect(embedder.embedded).toEqual([CHAIR.id])
  })

  scenario('Search ranks the most relevant products first', async () => {
    const service = new SearchIndexService(new HashingEmbedder())
    await service.sync([SOFA, CHAIR, LAMP])

    expect((await service.search('sofá de terciopelo terracota'))[0]!.id).toBe(SOFA.id)
    expect((await service.search('silla de roble para el comedor'))[0]!.id).toBe(CHAIR.id)
    expect((await service.search('lámpara de pie'))[0]!.id).toBe(LAMP.id)
  })

  scenario('Search stays fast with one hundred thousand products', () => {
    const dim = 256
    let seed = 42
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
    const filled = (size: number): VectorIndex => {
      const index = new VectorIndex(dim, size)
      const vector = new Float32Array(dim)
      for (let i = 0; i < size; i++) {
        for (let d = 0; d < dim; d++) vector[d] = random() - 0.5
        index.upsert(`p${i}`, vector)
      }
      return index
    }
    const query = new Float32Array(dim).map(() => random() - 0.5)
    // Mejor de 3 con calentamiento: el tiempo absoluto depende del entorno
    // (la instrumentación de cobertura multiplica el coste del bucle), así
    // que la garantía se afirma en relativo: escalar ×10 el catálogo no
    // puede costar mucho más de ×10 en tiempo, y siempre interactivo.
    const bestOf3 = (index: VectorIndex): number => {
      index.search(query, 20)
      let best = Infinity
      for (let run = 0; run < 3; run++) {
        const started = performance.now()
        index.search(query, 20)
        best = Math.min(best, performance.now() - started)
      }
      return best
    }

    const small = filled(10_000)
    const large = filled(100_000)
    const timeSmall = bestOf3(small)
    const timeLarge = bestOf3(large)

    expect(large.size).toBe(100_000)
    expect(large.search(query, 20)).toHaveLength(20)
    expect(timeLarge).toBeLessThan(Math.max(20 * timeSmall, 50))
    // El tope absoluto solo con base de tiempo sana: bajo instrumentación
    // pesada (mutation testing) el escalado relativo es la única garantía.
    if (timeSmall < 20) expect(timeLarge).toBeLessThan(400)
  })

  scenario('The search microservice serves sync and search over HTTP', async () => {
    const server = await startSearchServer({ port: 0, embedder: new HashingEmbedder(), dataDir: null })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const sync = await fetch(`${base}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: [SOFA, CHAIR, LAMP] }),
      })
      expect(sync.status).toBe(200)
      expect(await sync.json()).toMatchObject({ added: 3, total: 3 })

      const search = await fetch(`${base}/search?q=${encodeURIComponent('silla de roble')}`)
      expect(search.status).toBe(200)
      const payload = (await search.json()) as { results: { id: string }[] }
      expect(payload.results[0]!.id).toBe(CHAIR.id)

      const health = await fetch(`${base}/healthz`)
      expect(await health.json()).toMatchObject({ ok: true, products: 3 })
    } finally {
      await server.close()
    }
  })

  scenario('The index survives a restart through its persisted snapshot', async () => {
    const dir = tempDir()
    const first = new CountingEmbedder()
    const service = new SearchIndexService(first, new FileSnapshotStore(dir))
    await service.sync([SOFA, CHAIR])
    expect(first.embedded).toHaveLength(2)

    // "Reinicio": instancia nueva sobre la misma carpeta de datos.
    const second = new CountingEmbedder()
    const restarted = new SearchIndexService(second, new FileSnapshotStore(dir))
    expect(await restarted.restore()).toBe(true)
    expect(restarted.size).toBe(2)

    const hits = await restarted.search('sofá terciopelo')
    expect(hits[0]!.id).toBe(SOFA.id)

    // Y el siguiente refresco sigue siendo idempotente: nada se re-embebe.
    const report = await restarted.sync([SOFA, CHAIR])
    expect(report).toMatchObject({ unchanged: 2, total: 2 })
    expect(second.embedded).toHaveLength(0)
  })

  scenario('The embedding photo is the packshot, never the lifestyle shot', () => {
    const base = {
      name: 'Silla Olea',
      description: 'Silla de roble',
      width: 0.5,
      depth: 0.5,
      height: 0.8,
      price: 130,
      isSurface: false,
      color: '#fff',
      form: 'box' as const,
      origin: 'sklum',
    }
    const [withPackshot, withoutPackshot] = toSearchProducts(
      [
        {
          ...base,
          id: 'p1',
          assets: {
            imageUrl: '/catalog/sklum/images/p1.jpg',
            packshotUrl: '/catalog/sklum/gen-images/p1.jpg',
          },
        },
        { ...base, id: 'p2', assets: { imageUrl: '/catalog/sklum/images/p2.jpg' } },
      ],
      'https://cdn.example.com',
    )
    // El embedding ve SOLO el producto (packshot), nunca la foto de ambiente:
    // una silla oscura en un salón claro embebería el salón, no la silla.
    expect(withPackshot!.imageUrl).toBe('https://cdn.example.com/catalog/sklum/gen-images/p1.jpg')
    expect(withoutPackshot!.imageUrl).toBe('https://cdn.example.com/catalog/sklum/images/p2.jpg')
  })

  scenario('Search quality is measured with IR metrics against a golden set', async () => {
    const service = new SearchIndexService(new HashingEmbedder())
    await service.sync([SOFA, CHAIR, LAMP])

    const report = await evaluateSearch(
      (q, limit) => service.search(q, limit),
      [
        { query: 'sofá de terciopelo', relevant: [SOFA.id] },
        { query: 'silla de madera de roble', relevant: [CHAIR.id] },
        { query: 'lámpara dorada de arco', relevant: [LAMP.id] },
      ],
      5,
    )

    expect(report.perQuery).toHaveLength(3)
    for (const q of report.perQuery) {
      expect(q.recallAtK).toBeGreaterThan(0)
      expect(q.ndcgAtK).toBeGreaterThan(0)
      expect(q.ndcgAtK).toBeLessThanOrEqual(1)
    }
    // Con productos tan distintos, el relevante debe salir el primero siempre.
    expect(report.meanReciprocalRank).toBe(1)
    expect(report.meanRecallAtK).toBe(1)
  })

  scenario('The service exposes online quality signals beyond latency', async () => {
    const service = new SearchIndexService(new HashingEmbedder())
    await service.sync([SOFA, CHAIR, LAMP])
    const metrics = new Metrics()

    const strong = await service.search('sofá de terciopelo terracota', 5)
    metrics.observeSearchQuality(strong[0]?.score ?? null)
    const nonsense = await service.search('zzz qqq xxx', 5)
    metrics.observeSearchQuality(nonsense[0]?.score ?? null)

    const quality = metrics.snapshot().searchQuality as {
      searches: number
      lowConfidenceRate: number
      avgTopScore: number
      emptyRate: number
    }
    expect(quality.searches).toBe(2)
    // La consulta sin sentido cae por debajo del umbral de confianza…
    expect(quality.lowConfidenceRate).toBeGreaterThan(0)
    // …y la media del mejor score queda registrada como señal de deriva.
    expect(quality.avgTopScore).toBeGreaterThan(0)
  })
})
