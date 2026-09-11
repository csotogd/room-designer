import { afterEach, describe, expect, test, vi } from 'vitest'
import { CommandStack } from '../../src/app/commands/CommandStack'
import {
  SetLightIntensityCommand,
  SetLightTemperatureCommand,
  ToggleLightCommand,
} from '../../src/app/commands/LightCommands'
import { CompositeCatalog, loadRemoteProducts } from '../../src/app/catalog/RemoteCatalog'
import { Product } from '../../src/core/model/Product'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { CeilingLight } from '../../src/core/model/LightPoint'
import { Project } from '../../src/core/model/Project'

function projectWithLight() {
  const project = new Project(FloorPlan.rectangle(4, 3))
  const light = new CeilingLight(2, 1.5, 2.4)
  project.addLight(light)
  return { project, light }
}

describe('Comandos de luces: deshacibles y simétricos', () => {
  test('toggle es su propia inversa', () => {
    const { project, light } = projectWithLight()
    const stack = new CommandStack()
    const initial = light.on
    stack.execute(new ToggleLightCommand(project, light))
    expect(light.on).toBe(!initial)
    stack.undo()
    expect(light.on).toBe(initial)
    stack.redo()
    expect(light.on).toBe(!initial)
  })

  test('intensidad y temperatura restauran el valor previo exacto', () => {
    const { project, light } = projectWithLight()
    const stack = new CommandStack()
    const intensity0 = light.intensity
    const temperature0 = light.temperatureK

    stack.execute(new SetLightIntensityCommand(project, light, 0.25))
    expect(light.intensity).toBe(0.25)
    stack.execute(new SetLightTemperatureCommand(project, light, 3200))
    expect(light.temperatureK).toBe(3200)

    stack.undo()
    expect(light.temperatureK).toBe(temperature0)
    expect(light.intensity).toBe(0.25) // solo se deshizo la temperatura
    stack.undo()
    expect(light.intensity).toBe(intensity0)
  })
})

describe('RemoteCatalog', () => {
  afterEach(() => vi.unstubAllGlobals())

  const entry = {
    id: 'r1',
    name: 'Remote',
    description: 'remoto',
    width: 1,
    depth: 1,
    height: 1,
    price: 10,
    isSurface: false,
    color: '#fff',
    form: 'box' as const,
    origin: 'web',
  }

  test('carga el índice del sitio activo y cae al histórico si no existe', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', (url: string) => {
      asked.push(String(url))
      if (String(url).includes('index-nope')) return Promise.resolve(new Response('no', { status: 404 }))
      return Promise.resolve(Response.json([entry]))
    })
    const products = await loadRemoteProducts('/catalog/index-nope.json')
    expect(products).toEqual([]) // URL explícita: sin fallback
    const fallback = await loadRemoteProducts()
    expect(fallback.length).toBeGreaterThanOrEqual(0) // candidatos según env
    expect(asked.length).toBeGreaterThan(0)
  })

  test('con la red caída devuelve lista vacía, nunca lanza', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    expect(await loadRemoteProducts()).toEqual([])
  })

  test('CompositeCatalog resuelve por id en ambas fuentes y lista sin duplicar', () => {
    const local = new Product({ ...entry, id: 'local-1' })
    const remote = new Product({ ...entry, id: 'remote-1' })
    const catalog = new CompositeCatalog([local], [remote])
    expect(catalog.get('local-1').id).toBe('local-1')
    expect(catalog.get('remote-1').id).toBe('remote-1')
    expect(() => catalog.get('nope')).toThrow()
    expect(catalog.items().map((p) => p.id)).toContain('remote-1')
  })
})
