import { expect, test } from 'vitest'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Point2D } from '../../src/core/geometry/Point2D'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { fitsInRoom } from '../../src/app/editor/RoomBounds'
import { createRoomPlan } from '../../src/app/editor/RoomShapes'

const furniture = { ...new DefaultCatalog().get('table'), width: 6, depth: 1 }

test('the entire footprint must avoid a recess, including between its corners', () => {
  const room = createRoomPlan({ shape: 'u', width: 8, depth: 6, height: 3, cutWidth: 2, cutDepth: 2 })
  expect(fitsInRoom(room, furniture, 4, 5, 0)).toBe(false)
  expect(fitsInRoom(room, furniture, 4, 3.5, 0)).toBe(true)
  expect(fitsInRoom(room, { ...furniture, width: 1 }, 1.5, 5, 0)).toBe(true)
})

test('narrow recesses away from the furniture center are still blocked after rotation', () => {
  const corners = [[0, 0], [8, 0], [8, 6], [6.2, 6], [6.2, 4], [6, 4], [6, 6], [0, 6]]
  for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
    const rotate = (x: number, y: number) => new Point2D(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle))
    const room = FloorPlan.fromCorners(corners.map(([x, y]) => rotate(x!, y!)))
    const position = rotate(4, 5)
    expect(fitsInRoom(room, furniture, position.x, position.y, angle)).toBe(false)
    const inside = rotate(4, 2)
    expect(fitsInRoom(room, furniture, inside.x, inside.y, angle)).toBe(true)
  }
})
