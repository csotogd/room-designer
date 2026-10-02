import { expect, test } from 'vitest'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Point2D } from '../../src/core/geometry/Point2D'
import { Door } from '../../src/core/model/Door'
import { Wall } from '../../src/core/model/Wall'

test('previewing a wall preserves the source and moves connected corners', () => {
  const plan = FloorPlan.rectangle(5, 4)
  const wall = plan.walls[1]!
  const door = new Door(1, 0.9)
  wall.addOpening(door)
  const preview = plan.withWallGeometry(wall, new Point2D(7, 0), new Point2D(7, 4))
  expect(plan.floorPolygon()!.area()).toBe(20)
  expect(preview.floorPolygon()!.area()).toBe(28)
  expect(preview.walls[1]!.openings[0]).toBe(door)
  expect(preview.walls[0]!.end).toEqual(new Point2D(7, 0))
})

test('reshaping keeps wall instances, height, thickness and openings', () => {
  const plan = FloorPlan.rectangle(5, 4, 3)
  const wall = plan.walls[1]!
  wall.thickness = 0.2
  const door = new Door(1, 0.9)
  wall.addOpening(door)
  plan.reshapeWall(wall, new Point2D(7, 0), new Point2D(7, 4))
  expect(plan.walls[1]).toBe(wall)
  expect(wall.height).toBe(3)
  expect(wall.thickness).toBe(0.2)
  expect(wall.openings[0]).toBe(door)
  expect(plan.floorPolygon()!.area()).toBe(28)
})

test('invalid geometry never partially changes the original walls', () => {
  const plan = FloorPlan.rectangle(5, 4)
  const wall = plan.walls[1]!
  plan.walls[0]!.addOpening(new Door(4, 0.9))
  for (const [start, end] of [
    [new Point2D(4.5, 0), new Point2D(4.5, 4)],
    [new Point2D(-1, 2), new Point2D(5, 4)],
    [new Point2D(31, 0), new Point2D(31, 4)],
    [new Point2D(NaN, 0), new Point2D(5, 4)],
    [new Point2D(5, 0), new Point2D(5, 0.2)],
  ] as const) {
    expect(() => plan.reshapeWall(wall, start, end)).toThrow()
    expect(plan.floorPolygon()!.area()).toBe(20)
  }
  expect(() => plan.withWallGeometry(new Wall(wall.start, wall.end), wall.start, wall.end)).toThrow(/pertenece/)
})

test('a corner cannot cross a nonadjacent wall even when the signed area stays positive', () => {
  const plan = FloorPlan.rectangle(5, 4)
  expect(() => plan.reshapeWall(plan.walls[1]!, new Point2D(-1, 2), new Point2D(5, 4))).toThrow(/cruzarse/)
  expect(plan.floorPolygon()!.area()).toBe(20)
})
