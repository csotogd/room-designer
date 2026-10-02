import { expect } from 'vitest'
import { scenario } from './gherkin'
import { createRoomPlan, type RoomShape } from '../../src/app/editor/RoomShapes'
import { fitsInRoom } from '../../src/app/editor/RoomBounds'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'

scenario('Create rooms with rectangular, L, U, T and beveled floor plans', () => {
  const shapes: [RoomShape, number, number][] = [
    ['rect', 4, 48], ['l', 6, 44], ['u', 8, 44], ['t', 8, 36], ['bevel', 5, 46],
  ]
  for (const [shape, walls, area] of shapes) {
    const plan = createRoomPlan({ shape, width: 8, depth: 6, height: 3, cutWidth: 2, cutDepth: 2 })
    expect(plan.walls).toHaveLength(walls)
    expect(plan.floorPolygon()!.area()).toBeCloseTo(area)
    expect(plan.walls.every(w => w.height === 3)).toBe(true)
  }
})

scenario('Create small and large rooms with exact dimensions', () => {
  for (const [width, depth] of [[1, 2], [30, 20]]) {
    const plan = createRoomPlan({ shape: 'rect', width: width!, depth: depth!, height: 2.5, cutWidth: 0, cutDepth: 0 })
    expect(plan.floorPolygon()!.area()).toBe(width! * depth!)
  }
})

scenario('Reject invalid room dimensions and cutouts', () => {
  const dimensions = { shape: 'u' as const, width: 8, depth: 6, height: 3, cutWidth: 2, cutDepth: 2 }
  for (const invalid of [{ width: 0 }, { depth: 31 }, { height: NaN }, { cutWidth: 8 }, { cutDepth: 6 }]) {
    expect(() => createRoomPlan({ ...dimensions, ...invalid })).toThrow(/medidas|recorte/i)
  }
})

scenario('Furniture cannot bridge the recess of a concave room', () => {
  const room = createRoomPlan({ shape: 'u', width: 8, depth: 6, height: 3, cutWidth: 2, cutDepth: 2 })
  const furniture = { ...new DefaultCatalog().get('table'), width: 6, depth: 1 }
  expect(fitsInRoom(room, furniture, 4, 5, 0)).toBe(false)
})
