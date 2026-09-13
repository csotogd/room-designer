import { describe, expect, test } from 'vitest'
import { rankLocally } from '../../src/app/search/SearchClient'
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

})
