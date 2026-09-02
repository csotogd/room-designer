import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { Product, PRODUCT_FORMS } from '../../src/core/model/Product'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'

const catalog = new DefaultCatalog()

feature('Product catalog', () => {
  scenario('Every product carries name, description, price and dimensions', () => {
    for (const product of catalog.items()) {
      expect(product.name.length).toBeGreaterThan(0)
      expect(product.description.length).toBeGreaterThan(0)
      expect(product.price).toBeGreaterThan(0)
      expect(product.width).toBeGreaterThan(0)
      expect(product.depth).toBeGreaterThan(0)
      expect(product.height).toBeGreaterThan(0)
    }
  })

  scenario('The default catalog offers an extended range', () => {
    const products = catalog.items()
    expect(products.length).toBeGreaterThanOrEqual(18)
    expect(new Set(products.map((p) => p.id)).size).toBe(products.length)
  })

  scenario('Products can reference remote assets', () => {
    const remote = new Product({
      id: 'demo',
      name: 'Demo',
      description: 'Producto de prueba',
      width: 1,
      depth: 1,
      height: 1,
      price: 10,
      isSurface: false,
      color: '#888888',
      assets: {
        modelUrl: 'https://bucket.example.com/models/demo.glb',
        imageUrl: 'https://bucket.example.com/images/demo.jpg',
      },
    })
    expect(remote.assets.modelUrl).toBe('https://bucket.example.com/models/demo.glb')
    expect(remote.assets.imageUrl).toBe('https://bucket.example.com/images/demo.jpg')

    const local = catalog.get('table')
    expect(local.assets.modelUrl).toBeUndefined()
    expect(local.assets.imageUrl).toBeUndefined()
  })

  scenario('Every product declares a known 3D form', () => {
    for (const product of catalog.items()) {
      expect(PRODUCT_FORMS).toContain(product.form)
    }
  })
})
