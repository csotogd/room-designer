import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'

const catalog = new DefaultCatalog()
const item = (id: string) => catalog.get(id)
const room = () => new Project(FloorPlan.rectangle(5, 4))

feature('Furniture placement and stacking', () => {
  scenario('Place furniture on the floor', () => {
    const p = room()
    const sofa = p.placeFurniture(item('sofa'), 2, 1)
    expect(p.furniture).toHaveLength(1)
    expect(sofa.position.y).toBe(0)
  })

  scenario('Rotate a furniture item', () => {
    const p = room()
    const sofa = p.placeFurniture(item('sofa'), 2, 1)
    p.rotateFurniture(sofa, (90 * Math.PI) / 180)
    expect(sofa.rotationYDegrees()).toBeCloseTo(90)
  })

  scenario('Place a vase on top of a table', () => {
    const p = room()
    const table = p.placeFurniture(item('table'), 2, 2)
    const vase = p.placeOnTop(item('vase'), table)
    expect(vase.position.y).toBeCloseTo(item('table').height)
    expect(vase.supportedBy).toBe(table)
  })

  scenario('Moving the table moves the vase with it', () => {
    const p = room()
    const table = p.placeFurniture(item('table'), 2, 2)
    const vase = p.placeOnTop(item('vase'), table)
    p.moveFurniture(table, 4, 3)
    expect(vase.position.x).toBeCloseTo(4)
    expect(vase.position.z).toBeCloseTo(3)
  })

  scenario('Deleting the table drops the vase to the floor', () => {
    const p = room()
    const table = p.placeFurniture(item('table'), 2, 2)
    const vase = p.placeOnTop(item('vase'), table)
    p.removeFurniture(table)
    expect(vase.position.y).toBe(0)
    expect(vase.supportedBy).toBeUndefined()
  })

  scenario('Only surfaces accept items on top', () => {
    const p = room()
    const rug = p.placeFurniture(item('rug'), 1, 1)
    expect(() => p.placeOnTop(item('vase'), rug)).toThrow(/superficie|surface/i)
  })
})
