import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Project } from '../../src/core/model/Project'
import { CeilingLight } from '../../src/core/model/LightPoint'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { fitsInRoom } from '../../src/app/editor/RoomBounds'
import { dropFurniture } from '../../src/app/editor/FurnitureDrop'
import { addWizardOpening } from '../../src/app/editor/RoomWizard'
import { cartLines, cartTotal, LIGHT_PRICES } from '../../src/app/cart/Cart'
import {
  LocalStorageProjectRepository,
} from '../../src/app/persistence/LocalStorageProjectRepository'
import { serializeProject } from '../../src/app/serialization/ProjectSerializer'

const catalog = new DefaultCatalog()
const item = (id: string) => catalog.get(id)
const room = () => new Project(FloorPlan.rectangle(5, 4))

feature('Room bounds, creation wizard and shopping cart', () => {
  scenario('Furniture cannot sit outside the room', () => {
    const p = room()
    expect(fitsInRoom(p.floorPlan, item('sofa'), 2.5, 2, 0)).toBe(true)
    expect(fitsInRoom(p.floorPlan, item('sofa'), 10, 10, 0)).toBe(false)
  })

  scenario('A sofa against the wall must fit entirely, rotation included', () => {
    const p = room()
    // Sofá 2.0×0.9 pegado a la pared inferior: cabe en paralelo…
    expect(fitsInRoom(p.floorPlan, item('sofa'), 2.5, 0.6, 0)).toBe(true)
    // …pero girado 90° su largo (2.0) no cabe en 0.6 m hasta la pared.
    expect(fitsInRoom(p.floorPlan, item('sofa'), 2.5, 0.6, Math.PI / 2)).toBe(false)
  })

  scenario('Dropping furniture outside the room keeps it where it was', () => {
    const p = room()
    const sofa = p.placeFurniture(item('sofa'), 2, 2)
    dropFurniture(p, sofa, 9, 9)
    expect(sofa.position.x).toBe(2)
    expect(sofa.position.z).toBe(2)
  })

  scenario('The wizard places a door on a wall before creating the room', () => {
    const plan = FloorPlan.rectangle(5, 4)
    const placed = addWizardOpening(plan, 0, 'door', 1.5)
    expect(placed).not.toBeNull()
    expect(plan.walls[0]!.openings).toHaveLength(1)
  })

  scenario('The wizard rejects an opening over another one', () => {
    const plan = FloorPlan.rectangle(5, 4)
    addWizardOpening(plan, 0, 'door', 1.5)
    expect(addWizardOpening(plan, 0, 'window', 1.6)).toBeNull()
    expect(plan.walls[0]!.openings).toHaveLength(1)
  })

  scenario('The wizard clamps openings to the wall ends', () => {
    const plan = FloorPlan.rectangle(5, 4)
    const window = addWizardOpening(plan, 0, 'window', 99)
    expect(window).not.toBeNull()
    expect(window!.end).toBeCloseTo(5)
  })

  scenario('Placed items appear in the cart grouped with prices', () => {
    const p = room()
    p.placeFurniture(item('chair'), 1, 1)
    p.placeFurniture(item('chair'), 2, 1)
    p.placeFurniture(item('table'), 3, 2)
    const lines = cartLines(p)
    expect(lines).toHaveLength(2)
    const chairs = lines.find((l) => l.id === 'chair')!
    expect(chairs.quantity).toBe(2)
    expect(chairs.subtotal).toBeCloseTo(item('chair').price * 2)
  })

  scenario('The cart total sums furniture and lights', () => {
    const p = room()
    p.placeFurniture(item('table'), 2, 2)
    p.addLight(new CeilingLight(2.5, 2, p.ceilingHeight))
    expect(cartTotal(p)).toBeCloseTo(item('table').price + LIGHT_PRICES.ceiling)
  })

  scenario('Removing an item updates the cart', () => {
    const p = room()
    const table = p.placeFurniture(item('table'), 2, 2)
    p.addLight(new CeilingLight(2.5, 2, p.ceilingHeight))
    p.removeFurniture(table)
    expect(cartLines(p)).toHaveLength(1)
  })

  scenario('Projects persist through the repository port', async () => {
    const storage = new Map<string, string>()
    const repository = new LocalStorageProjectRepository({
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
    })
    const p = room()
    p.placeFurniture(item('table'), 2, 2)
    const doc = serializeProject(p)
    await repository.save(doc)
    expect(await repository.load()).toEqual(doc)
  })
})
