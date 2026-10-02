import { describe, expect, test } from 'vitest'
import { createRoomPlan, type RoomShape } from '../../src/app/editor/RoomShapes'

const dimensions = { width: 8, depth: 6, height: 3, cutWidth: 2, cutDepth: 1 }

describe('Room shapes', () => {
  test.each<[RoomShape, number[][]]>([
    ['rect', [[0, 0], [8, 0], [8, 6], [0, 6]]],
    ['l', [[0, 0], [8, 0], [8, 5], [6, 5], [6, 6], [0, 6]]],
    ['u', [[0, 0], [8, 0], [8, 6], [5, 6], [5, 5], [3, 5], [3, 6], [0, 6]]],
    ['t', [[0, 0], [8, 0], [8, 5], [5, 5], [5, 6], [3, 6], [3, 5], [0, 5]]],
    ['bevel', [[0, 0], [8, 0], [8, 5], [6, 6], [0, 6]]],
  ])('%s connects the intended corners', (shape, corners) => {
    const plan = createRoomPlan({ ...dimensions, shape })
    expect(plan.floorPolygon()!.vertices.map(p => [p.x, p.y])).toEqual(corners)
    expect(plan.walls.map(w => w.height)).toEqual(corners.map(() => 3))
  })

  test.each(['width', 'depth', 'height'] as const)('validates finite %s within limits', (field) => {
    const [min, max] = field === 'height' ? [2, 6] : [1, 30]
    for (const value of [NaN, Infinity, -Infinity, min - 0.01, max + 0.01]) {
      expect(() => createRoomPlan({ ...dimensions, shape: 'rect', [field]: value })).toThrow(/medidas/i)
    }
    for (const value of [min, max]) {
      expect(() => createRoomPlan({ ...dimensions, shape: 'rect', [field]: value })).not.toThrow()
    }
  })

  test.each(['cutWidth', 'cutDepth'] as const)('rejects collapsed or nonfinite %s', field => {
    for (const value of [NaN, Infinity, 0, -1, field === 'cutWidth' ? 8 : 6, 99]) {
      expect(() => createRoomPlan({ ...dimensions, shape: 'l', [field]: value })).toThrow(/recorte/i)
    }
    expect(() => createRoomPlan({ ...dimensions, shape: 'l', [field]: 0.1 })).not.toThrow()
  })
})
