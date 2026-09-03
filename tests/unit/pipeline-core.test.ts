import { describe, expect, test } from 'vitest'
import { withTimeout } from '../../pipeline/core/withTimeout'
import { toAppCatalogEntry } from '../../pipeline/core/appCatalog'
import type { ScrapedProduct } from '../../pipeline/core/types'

const scraped = (over: Partial<ScrapedProduct> = {}): ScrapedProduct => ({
  id: 'p1',
  site: 'sklum',
  sourceUrl: 'https://example.com/p1',
  name: 'Mesa de comedor',
  imageUrl: 'https://cdn.example.com/p1.jpg',
  price: 199,
  widthCm: 120,
  depthCm: 80,
  heightCm: 75,
  extraDims: {},
  imagePath: 'sklum/images/p1.jpg',
  ...over,
})

describe('withTimeout', () => {
  test('resuelve con el valor si la promesa llega antes del límite', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'op')).resolves.toBe(42)
  })

  test('rechaza con etiqueta y segundos si se agota el tiempo', async () => {
    const eternal = new Promise(() => {})
    await expect(withTimeout(eternal, 20, 'cola del Space')).rejects.toThrow(
      /timeout de 0\.02s en cola del Space/,
    )
  })

  test('propaga el rechazo original de la promesa', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'op')).rejects.toThrow('boom')
  })
})

describe('toAppCatalogEntry: bordes', () => {
  test('sin medidas o sin foto no hay entrada', () => {
    expect(toAppCatalogEntry(scraped({ widthCm: undefined }), '/c')).toBeNull()
    expect(toAppCatalogEntry(scraped({ heightCm: undefined }), '/c')).toBeNull()
    expect(toAppCatalogEntry(scraped({ imagePath: undefined }), '/c')).toBeNull()
  })

  test('convierte cm a metros y usa el ancho como fondo si falta', () => {
    const entry = toAppCatalogEntry(scraped({ depthCm: undefined }), '/c')!
    expect(entry.width).toBeCloseTo(1.2)
    expect(entry.depth).toBeCloseTo(1.2)
    expect(entry.height).toBeCloseTo(0.75)
  })

  test('las rutas de assets se codifican por segmento bajo la base', () => {
    const entry = toAppCatalogEntry(
      scraped({ imagePath: 'sklum/images/silla añil.jpg', modelPath: 'sklum/models/p1.glb' }),
      '/catalog',
    )!
    expect(entry.assets.imageUrl).toBe('/catalog/sklum/images/silla%20a%C3%B1il.jpg')
    expect(entry.assets.modelUrl).toBe('/catalog/sklum/models/p1.glb')
  })

  test('detecta superficies por nombre y precio ausente vale 0', () => {
    expect(toAppCatalogEntry(scraped({ name: 'Mesita de noche' }), '/c')!.isSurface).toBe(true)
    expect(toAppCatalogEntry(scraped({ name: 'Silla plegable' }), '/c')!.isSurface).toBe(false)
    expect(toAppCatalogEntry(scraped({ price: undefined }), '/c')!.price).toBe(0)
  })

  test('el id compuesto y el origen preservan el sitio', () => {
    const entry = toAppCatalogEntry(scraped(), '/c')!
    expect(entry.id).toBe('sklum-p1')
    expect(entry.origin).toBe('sklum')
    expect(entry.description).toContain('120×80×75 cm')
    expect(entry.description).toContain('https://example.com/p1')
  })
})
