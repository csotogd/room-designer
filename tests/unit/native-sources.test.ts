import { describe, expect, test } from 'vitest'
import { PolyHavenCatalogScraper } from '../../pipeline/adapters/PolyHavenCatalogScraper'
import { SketchfabCatalogScraper, resolveGlbUrl } from '../../pipeline/adapters/SketchfabCatalogScraper'
import { furnitureDimsFromGlb, furnitureDimsFromSize, glbSceneSize, parseGlbJson } from '../../pipeline/core/glb'
import { toAppCatalogEntry } from '../../pipeline/core/appCatalog'
import { carryOverGeneration, type ScrapedProduct } from '../../pipeline/core/types'
import { defaultSiteId } from '../../pipeline/adapters/sites'

/* ───────────────────────────── Poly Haven ───────────────────────────── */

const polyHavenApi: Record<string, unknown> = {
  'https://api.polyhaven.com/assets?type=models': {
    ArmChair_01: {
      name: 'Arm Chair 01',
      description: 'Vintage armchair',
      category: 'Furniture/Seating/Chairs',
      tags: ['chair', 'vintage'],
      authors: { 'Kirill Sannikov': 'All' },
      dimensions: [848.4, 765.7, 1065.1],
      files_hash: 'hash-1',
    },
    NoGltf_01: { name: 'Sin glTF', dimensions: [100, 100, 100], files_hash: 'x' },
  },
  'https://api.polyhaven.com/files/ArmChair_01': {
    gltf: {
      '1k': {
        gltf: {
          url: 'https://dl.example/ArmChair_01.gltf',
          size: 1,
          md5: 'm',
          include: {
            'ArmChair_01.bin': { url: 'https://dl.example/ArmChair_01.bin', size: 1, md5: 'm' },
            'textures/diff.jpg': { url: 'https://dl.example/diff.jpg', size: 1, md5: 'm' },
          },
        },
      },
    },
  },
  'https://api.polyhaven.com/files/NoGltf_01': { blend: {} },
}

describe('PolyHavenCatalogScraper', () => {
  test('convierte el asset en producto CC0 con medidas y manifiesto de ficheros', async () => {
    const scraper = new PolyHavenCatalogScraper(async (url) => polyHavenApi[url])
    const products = await scraper.scrape(Infinity)
    expect(products).toHaveLength(1) // NoGltf_01 se descarta: no publica glTF
    const chair = products[0]!
    expect(chair.id).toBe('ArmChair_01')
    expect(chair.site).toBe('polyhaven')
    expect(chair.license).toBe('CC0')
    expect(chair.author).toBe('Kirill Sannikov')
    expect(chair.widthCm).toBeCloseTo(84.8)
    expect(chair.heightCm).toBeCloseTo(106.5)
    expect(chair.description).toContain('Furniture/Seating/Chairs')
    expect(chair.modelSourceHash).toBe('hash-1')
    expect(chair.modelSource).toEqual({
      kind: 'gltf-files',
      entry: 'ArmChair_01.gltf',
      files: {
        'ArmChair_01.gltf': 'https://dl.example/ArmChair_01.gltf',
        'ArmChair_01.bin': 'https://dl.example/ArmChair_01.bin',
        'textures/diff.jpg': 'https://dl.example/diff.jpg',
      },
    })
  })

  test('el límite corta la lista de assets', async () => {
    const scraper = new PolyHavenCatalogScraper(async (url) => polyHavenApi[url])
    expect(await scraper.scrape(0)).toHaveLength(0)
  })
})

/* ───────────────────────────── Sketchfab ───────────────────────────── */

const sketchfabResult = (over: Record<string, unknown> = {}) => ({
  uid: 'abc123',
  name: 'Side Chair',
  description: 'A carved side chair',
  viewerUrl: 'https://sketchfab.com/3d-models/side-chair-abc123',
  publishedAt: '2020-02-21T19:36:49Z',
  isDownloadable: true,
  license: { label: 'CC0 Public Domain' },
  user: { username: 'museum' },
  tags: [{ name: 'chair' }, { name: 'wood' }],
  thumbnails: {
    images: [
      { width: 1920, url: 'https://media.example/1920.jpg' },
      { width: 720, url: 'https://media.example/720.jpg' },
      { width: 256, url: 'https://media.example/256.jpg' },
    ],
  },
  archives: { glb: { size: 5_000_000 } },
  ...over,
})

function sketchfabFetch(pages: Record<string, unknown>) {
  return async (url: string) => {
    const page = pages[url]
    if (!page) throw new Error(`URL inesperada: ${url}`)
    return page
  }
}

describe('SketchfabCatalogScraper', () => {
  const searchUrl = (license: string) =>
    `https://api.sketchfab.com/v3/search?type=models&downloadable=true&license=${license}` +
    '&categories=furniture-home&count=24'

  test('pagina cc0 y cc-by, deduplica y construye productos con atribución', async () => {
    const scraper = new SketchfabCatalogScraper(
      sketchfabFetch({
        [searchUrl('cc0')]: { results: [sketchfabResult()], next: 'https://next.page' },
        'https://next.page': { results: [sketchfabResult({ uid: 'def456', name: 'Stool' })], next: null },
        [searchUrl('by')]: {
          results: [sketchfabResult(), sketchfabResult({ uid: 'ghi789', license: { label: 'CC Attribution' } })],
          next: null,
        },
      }),
    )
    const products = await scraper.scrape(Infinity)
    expect(products.map((p) => p.id)).toEqual(['abc123', 'def456', 'ghi789'])
    const chair = products[0]!
    expect(chair.license).toBe('CC0 Public Domain')
    expect(chair.author).toBe('museum')
    expect(chair.imageUrl).toBe('https://media.example/720.jpg') // la menor ≥512
    expect(chair.widthCm).toBeUndefined() // medidas: solo al descargar el GLB
    expect(chair.modelSource).toEqual({
      kind: 'glb',
      url: 'https://api.sketchfab.com/v3/models/abc123/download',
    })
    expect(chair.modelSourceHash).toBe('2020-02-21T19:36:49Z:5000000')
  })

  test('descarta no descargables y GLB gigantes', async () => {
    const scraper = new SketchfabCatalogScraper(
      sketchfabFetch({
        [searchUrl('cc0')]: {
          results: [
            sketchfabResult({ isDownloadable: false }),
            sketchfabResult({ uid: 'big', archives: { glb: { size: 999_000_000 } } }),
          ],
          next: null,
        },
        [searchUrl('by')]: { results: [], next: null },
      }),
    )
    expect(await scraper.scrape(Infinity)).toHaveLength(0)
  })

  test('resolveGlbUrl canjea el endpoint por la URL temporal con token', async () => {
    const calls: [string, Record<string, string> | undefined][] = []
    const url = await resolveGlbUrl('https://api.sketchfab.com/v3/models/abc/download', 'tok', async (u, h) => {
      calls.push([u, h])
      return { glb: { url: 'https://temp.example/model.glb' } }
    })
    expect(url).toBe('https://temp.example/model.glb')
    expect(calls[0]![1]).toEqual({ Authorization: 'Token tok' })
  })

  test('resolveGlbUrl falla claro si la respuesta no trae GLB', async () => {
    await expect(resolveGlbUrl('https://x/download', 'tok', async () => ({}))).rejects.toThrow(
      /no devolvió URL de GLB/,
    )
  })
})

/* ─────────────────────── Parser de dimensiones GLB ─────────────────────── */

/** GLB mínimo: un nodo escalado con un accessor POSITION con min/max. */
function makeGlb(json: unknown): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const padded = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4).fill(0x20)
  padded.set(jsonBytes)
  const total = 12 + 8 + padded.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true) // magic "glTF"
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, padded.length, true)
  view.setUint32(16, 0x4e4f534a, true) // chunk JSON
  out.set(padded, 20)
  return out
}

const gltfScene = {
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, scale: [2, 1, 1], translation: [5, 0, 0] }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ min: [-0.25, 0, -0.3], max: [0.25, 0.9, 0.3] }],
}

describe('glb: dimensiones', () => {
  test('parsea el contenedor y mide la escena con transformaciones', () => {
    const size = glbSceneSize(parseGlbJson(makeGlb(gltfScene)))!
    expect(size.x).toBeCloseTo(1) // 0.5 de ancho × escala 2
    expect(size.y).toBeCloseTo(0.9)
    expect(size.z).toBeCloseTo(0.6)
  })

  test('rechaza bytes que no son GLB', () => {
    expect(() => parseGlbJson(new TextEncoder().encode('hola mundo, no soy glb'))).toThrow(/magic/)
  })

  test('convierte a cm de mueble eligiendo el factor de unidades plausible', () => {
    // Metros tal cual.
    expect(furnitureDimsFromSize({ x: 0.5, y: 0.9, z: 0.6 })).toEqual({
      widthCm: 50,
      depthCm: 60,
      heightCm: 90,
    })
    // Modelo exportado en milímetros: 900 unidades de alto.
    expect(furnitureDimsFromSize({ x: 500, y: 900, z: 600 })).toEqual({
      widthCm: 50,
      depthCm: 60,
      heightCm: 90,
    })
    // Nada plausible (demasiado grande incluso reescalado).
    expect(furnitureDimsFromSize({ x: 0, y: 0, z: 0 })).toBeNull()
  })

  test('furnitureDimsFromGlb integra parser y heurística', () => {
    const dims = furnitureDimsFromGlb(makeGlb(gltfScene))!
    expect(dims.heightCm).toBeCloseTo(90)
    expect(dims.widthCm).toBeCloseTo(100)
  })
})

/* ──────────────── carryOver por hash de fuente y appCatalog ──────────────── */

const nativeProduct = (over: Partial<ScrapedProduct> = {}): ScrapedProduct => ({
  id: 'ArmChair_01',
  site: 'polyhaven',
  sourceUrl: 'https://polyhaven.com/a/ArmChair_01',
  name: 'Arm Chair 01',
  description: 'Vintage armchair',
  imageUrl: 'https://cdn.example/a.png',
  license: 'CC0',
  author: 'Kirill Sannikov',
  extraDims: {},
  modelSource: { kind: 'glb', url: 'https://dl.example/a.glb' },
  modelSourceHash: 'hash-1',
  ...over,
})

describe('carryOverGeneration con fuentes nativas', () => {
  test('conserva modelo y medidas si la huella de la fuente no cambió', () => {
    const previous = nativeProduct({
      modelPath: 'polyhaven/models/a.glb',
      widthCm: 84.8,
      depthCm: 76.6,
      heightCm: 106.5,
      quality: { status: 'approved', judge: 'native-polyhaven' },
    })
    const next = nativeProduct()
    carryOverGeneration(previous, next)
    expect(next.modelPath).toBe('polyhaven/models/a.glb')
    expect(next.heightCm).toBeCloseTo(106.5)
    expect(next.quality?.status).toBe('approved')
  })

  test('si la fuente publica otra huella, el modelo caduca', () => {
    const previous = nativeProduct({ modelPath: 'polyhaven/models/a.glb' })
    const next = nativeProduct({ modelSourceHash: 'hash-2' })
    carryOverGeneration(previous, next)
    expect(next.modelPath).toBeUndefined()
  })

  test('los productos de foto siguen caducando por packshot', () => {
    const previous = nativeProduct({
      modelSource: undefined,
      modelPath: 'sklum/models/p.glb',
      generationImageUrl: 'https://cdn/p1.jpg',
    })
    const next = nativeProduct({ modelSource: undefined, generationImageUrl: 'https://cdn/p2.jpg' })
    carryOverGeneration(previous, next)
    expect(next.modelPath).toBeUndefined()
  })
})

describe('toAppCatalogEntry con fuentes nativas', () => {
  test('publica descripción editorial, licencia y autor', () => {
    const entry = toAppCatalogEntry(
      nativeProduct({
        widthCm: 84.8,
        depthCm: 76.6,
        heightCm: 106.5,
        imagePath: 'polyhaven/images/a.jpg',
        modelPath: 'polyhaven/models/ArmChair_01/ArmChair_01.gltf',
      }),
      '/catalog',
    )!
    expect(entry.description).toBe('Vintage armchair')
    expect(entry.license).toBe('CC0')
    expect(entry.author).toBe('Kirill Sannikov')
    expect(entry.price).toBe(0)
    expect(entry.assets.modelUrl).toBe('/catalog/polyhaven/models/ArmChair_01/ArmChair_01.gltf')
  })
})

describe('defaultSiteId', () => {
  test('lee CATALOG_SITE y cae a sklum sin variable', () => {
    expect(defaultSiteId({ CATALOG_SITE: 'polyhaven' })).toBe('polyhaven')
    expect(defaultSiteId({})).toBe('sklum')
  })
})
