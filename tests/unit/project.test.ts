import { describe, expect, test } from 'vitest'
import { Point2D } from '../../src/core/geometry/Point2D'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { CeilingLight } from '../../src/core/model/LightPoint'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'

const catalog = new DefaultCatalog()
const item = (id: string) => catalog.get(id)

function room(): Project {
  return new Project(FloorPlan.rectangle(5, 4))
}

describe('Project events', () => {
  test('emits changed when furniture is placed', () => {
    const p = room()
    let events = 0
    p.events.on('changed', () => void (events += 1))
    p.placeFurniture(item('sofa'), 2, 1)
    expect(events).toBe(1)
  })

  test('emits changed when a light is toggled', () => {
    const p = room()
    const light = new CeilingLight(2.5, 2, p.ceilingHeight)
    p.addLight(light)
    let events = 0
    p.events.on('changed', () => void (events += 1))
    p.toggleLight(light)
    expect(events).toBe(1)
  })
})

describe('Light properties', () => {
  test('intensity is clamped to [0, 1]', () => {
    const light = new CeilingLight(0, 0, 2.5)
    light.setIntensity(4)
    expect(light.intensity).toBe(1)
    light.setIntensity(-1)
    expect(light.intensity).toBe(0)
  })

  test('temperature is clamped to [2000, 6500] kelvin', () => {
    const light = new CeilingLight(0, 0, 2.5)
    light.setTemperature(1000)
    expect(light.temperatureK).toBe(2000)
    light.setTemperature(99999)
    expect(light.temperatureK).toBe(6500)
  })
})

describe('Sun', () => {
  test('altitude peaks at noon and reaches the horizon at 6 and 18', () => {
    const p = room()
    p.setTimeOfDay(12)
    const noon = p.sunAltitude()
    p.setTimeOfDay(6)
    const dawn = p.sunAltitude()
    p.setTimeOfDay(18)
    const dusk = p.sunAltitude()
    expect(noon).toBeGreaterThan(dawn)
    expect(dawn).toBeCloseTo(0)
    expect(dusk).toBeCloseTo(0)
  })

  test('time of day stays within [0, 24)', () => {
    const p = room()
    p.setTimeOfDay(30)
    expect(p.timeOfDay).toBeLessThan(24)
    expect(p.timeOfDay).toBeGreaterThanOrEqual(0)
  })
})

describe('Stacking rules', () => {
  test('an item cannot support itself', () => {
    const p = room()
    const table = p.placeFurniture(item('table'), 2, 2)
    expect(() => p.placeOnTop(item('vase'), table).supportChain()).not.toThrow()
    expect(() => p.support(table, table)).toThrow()
  })

  test('clearSupport drops the item to the floor and detaches it', () => {
    const p = room()
    const table = p.placeFurniture(item('table'), 2, 2)
    const vase = p.placeOnTop(item('vase'), table)
    p.clearSupport(vase)
    expect(vase.supportedBy).toBeUndefined()
    expect(vase.position.y).toBe(0)
  })

  test('containsPlanPoint respects rotation', () => {
    const p = room()
    const sofa = p.placeFurniture(item('sofa'), 0, 0) // 2.0 x 0.9
    expect(sofa.containsPlanPoint(new Point2D(0.9, 0))).toBe(true)
    expect(sofa.containsPlanPoint(new Point2D(0, 0.9))).toBe(false)
    p.rotateFurniture(sofa, Math.PI / 2)
    expect(sofa.containsPlanPoint(new Point2D(0, 0.9))).toBe(true)
    expect(sofa.containsPlanPoint(new Point2D(0.9, 0))).toBe(false)
  })

  test('circular support is rejected', () => {
    const p = room()
    const table = p.placeFurniture(item('table'), 1, 1)
    const shelf = p.placeOnTop(item('shelf'), table)
    expect(() => p.support(table, shelf)).toThrow(/circular|ciclo/i)
  })
})
