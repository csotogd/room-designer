import { expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { feature, scenario } from './gherkin'
import { extractJsonLdProduct } from '../../pipeline/adapters/jsonld'
import { LocalFolderAssetStore } from '../../pipeline/adapters/LocalFolderAssetStore'
import { pendingProducts, type ScrapedProduct } from '../../pipeline/core/types'

const FIXTURE_HTML = `
<html><head>
<script type="application/ld+json">{"@type":"WebPage","name":"x"}</script>
<script type="application/ld+json">{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Silla de comedor Tento",
  "image": ["https://cdn.example.com/tento.jpg"],
  "offers": {"@type": "Offer", "price": "79.95", "priceCurrency": "EUR"},
  "additionalProperty": [
    {"@type": "QuantitativeValue", "name": "Alto", "value": "82,5", "unitCode": "cm"},
    {"@type": "QuantitativeValue", "name": "Ancho", "value": "46,5", "unitCode": "cm"},
    {"@type": "QuantitativeValue", "name": "Profundo", "value": "53", "unitCode": "cm"},
    {"@type": "QuantitativeValue", "name": "Peso", "value": "5,2", "unitCode": "kg"}
  ]
}</script>
</head><body></body></html>`

function product(id: string, withModel = false): ScrapedProduct {
  return {
    id,
    site: 'test',
    sourceUrl: `https://example.com/${id}.html`,
    name: id,
    imageUrl: `https://cdn.example.com/${id}.jpg`,
    extraDims: {},
    imagePath: `test/images/${id}.jpg`,
    ...(withModel ? { modelPath: `test/models/${id}.glb` } : {}),
  }
}

feature('Catalog ingestion and mesh generation pipeline', () => {
  scenario('A product page with JSON-LD yields name, image, price and dimensions', () => {
    const p = extractJsonLdProduct(FIXTURE_HTML, 'https://example.com/silla-tento.html', 'sklum')
    expect(p).not.toBeNull()
    expect(p!.name).toBe('Silla de comedor Tento')
    expect(p!.imageUrl).toBe('https://cdn.example.com/tento.jpg')
    expect(p!.price).toBeCloseTo(79.95)
    expect(p!.currency).toBe('EUR')
    expect(p!.heightCm).toBeCloseTo(82.5)
    expect(p!.widthCm).toBeCloseTo(46.5)
    expect(p!.depthCm).toBeCloseTo(53)
    expect(p!.extraDims.peso).toBeCloseTo(5.2)
    expect(p!.id).toBe('silla-tento')
  })

  scenario('Scraped assets are laid out like a bucket', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bucket-'))
    const store = new LocalFolderAssetStore(root)
    const p = product('silla-x')
    p.imagePath = await store.saveImage('sklum', p.id, new Uint8Array([1, 2, 3]))
    await store.saveProducts('sklum', [p])

    expect(p.imagePath).toBe(join('sklum', 'images', 'silla-x.jpg'))
    expect(existsSync(join(root, 'sklum', 'images', 'silla-x.jpg'))).toBe(true)
    const saved = JSON.parse(readFileSync(join(root, 'sklum', 'products.json'), 'utf8'))
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe('silla-x')
    expect(await store.readProducts('sklum')).toEqual(saved)
  })

  scenario('The generation queue only picks products without a model', () => {
    const products = [product('a'), product('b', true), product('c')]
    const queue = pendingProducts(products)
    expect(queue.map((p) => p.id)).toEqual(['a', 'c'])
  })

  scenario('The packshot scorer prefers clean studio shots over lifestyle photos', async () => {
    const sharp = (await import('sharp')).default
    const { packshotScore } = await import('../../pipeline/adapters/packshot')

    // "Packshot": fondo claro uniforme con el producto oscuro en el centro.
    const studio = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 244, g: 242, b: 238 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 20, height: 30, channels: 3, background: { r: 60, g: 40, b: 25 } },
          })
            .png()
            .toBuffer(),
          left: 22,
          top: 20,
        },
      ])
      .png()
      .toBuffer()

    // "Bodegón": la escena llena el encuadre hasta los bordes (ruido).
    const noise = Buffer.alloc(64 * 64 * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 255
    const lifestyle = await sharp(noise, { raw: { width: 64, height: 64, channels: 3 } })
      .png()
      .toBuffer()

    const studioScore = await packshotScore(studio)
    const lifestyleScore = await packshotScore(lifestyle)
    expect(studioScore).toBeGreaterThan(lifestyleScore)
  })

  scenario('Bucket products become app catalog entries in meters', async () => {
    const { toAppCatalogEntry } = await import('../../pipeline/core/appCatalog')
    const scraped: ScrapedProduct = {
      ...product('silla-tento', true),
      name: 'Mesa de comedor Tento',
      price: 79.95,
      widthCm: 46.5,
      depthCm: 53,
      heightCm: 82.5,
    }
    const entry = toAppCatalogEntry(scraped, '/catalog')!
    expect(entry.width).toBeCloseTo(0.465)
    expect(entry.depth).toBeCloseTo(0.53)
    expect(entry.height).toBeCloseTo(0.825)
    expect(entry.price).toBeCloseTo(79.95)
    expect(entry.isSurface).toBe(true)
    expect(entry.assets.imageUrl).toBe('/catalog/test/images/silla-tento.jpg')
    expect(entry.assets.modelUrl).toBe('/catalog/test/models/silla-tento.glb')

    const withoutModel = toAppCatalogEntry(
      { ...scraped, modelPath: undefined },
      '/catalog',
    )!
    expect(withoutModel.assets.modelUrl).toBeUndefined()
    expect(withoutModel.assets.imageUrl).toBeDefined()
  })
})
