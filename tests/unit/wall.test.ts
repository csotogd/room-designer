import { describe, expect, test } from 'vitest'
import { Point2D } from '../../src/core/geometry/Point2D'
import { Wall } from '../../src/core/model/Wall'
import { Door } from '../../src/core/model/Door'
import { Window } from '../../src/core/model/Window'
import { FloorPlan } from '../../src/core/model/FloorPlan'

const wall = () => new Wall(new Point2D(0, 0), new Point2D(5, 0))

describe('Wall', () => {
  test('resizes a member opening without replacing it or moving its start', () => {
    const w = wall()
    const door = new Door(1, 0.9)
    w.addOpening(door)
    w.resizeOpening(door, 1.8)
    expect(w.openings[0]).toBe(door)
    expect(door.width).toBe(1.8)
    expect(door.offset).toBe(1)
  })

  test('available width ends at the nearest following opening or wall end', () => {
    const w = wall()
    const door = new Door(1, 0.9)
    w.addOpening(door)
    expect(w.maxOpeningWidth(door)).toBe(4)
    w.addOpening(new Window(4, 0.5))
    w.addOpening(new Window(3, 0.5))
    w.addOpening(new Door(0, 0.5))
    expect(w.maxOpeningWidth(door)).toBe(2)
    w.resizeOpening(door, 2)
    expect(door.end).toBe(3)
  })

  test('invalid resize leaves the opening unchanged', () => {
    const w = wall()
    const door = new Door(1, 0.9)
    w.addOpening(door)
    w.addOpening(new Window(3, 1))
    for (const width of [0, -1, NaN, Infinity, 2.01, 6]) {
      expect(() => w.resizeOpening(door, width)).toThrow()
      expect(door.width).toBe(0.9)
    }
    expect(() => w.resizeOpening(new Door(1, 0.9), 1)).toThrow(/pertenece/)
  })

  test('has length, default thickness and height', () => {
    const w = wall()
    expect(w.length()).toBe(5)
    expect(w.thickness).toBeGreaterThan(0)
    expect(w.height).toBeGreaterThan(0)
  })

  test('accepts an opening inside its bounds', () => {
    const w = wall()
    w.addOpening(new Door(1, 0.9))
    expect(w.openings).toHaveLength(1)
  })

  test('rejects an opening that starts before the wall', () => {
    expect(() => wall().addOpening(new Door(-0.5, 0.9))).toThrow(/dentro|within|bounds/i)
  })

  test('rejects an opening that ends past the wall', () => {
    expect(() => wall().addOpening(new Door(4.5, 0.9))).toThrow(/dentro|within|bounds/i)
  })

  test('rejects overlapping openings, accepts adjacent ones', () => {
    const w = wall()
    w.addOpening(new Door(1, 0.9))
    expect(() => w.addOpening(new Window(1.5, 1.2, 1.1, 0.9))).toThrow(/solapa|overlap/i)
    w.addOpening(new Window(1.9, 1.2, 1.1, 0.9))
    expect(w.openings).toHaveLength(2)
  })

  test('computes the world center of an opening', () => {
    const w = wall()
    const door = new Door(1, 0.9)
    w.addOpening(door)
    expect(w.worldCenterOf(door).equals(new Point2D(1.45, 0))).toBe(true)
  })

  test('openings keep their parametric position when the wall moves', () => {
    const w = wall()
    const door = new Door(1, 0.9)
    w.addOpening(door)
    w.moveTo(new Point2D(0, 0), new Point2D(0, 5))
    expect(w.worldCenterOf(door).equals(new Point2D(0, 1.45))).toBe(true)
  })

  test('removing an opening', () => {
    const w = wall()
    const door = new Door(1, 0.9)
    w.addOpening(door)
    w.removeOpening(door)
    expect(w.openings).toHaveLength(0)
  })
})

describe('FloorPlan', () => {
  test('a closed rectangle yields a floor polygon with area', () => {
    const plan = FloorPlan.rectangle(5, 4)
    const floor = plan.floorPolygon()
    expect(floor).not.toBeNull()
    expect(floor!.vertices).toHaveLength(4)
    expect(floor!.area()).toBeCloseTo(20)
  })

  test('an open chain of walls has no floor polygon', () => {
    const plan = new FloorPlan()
    plan.addWall(new Wall(new Point2D(0, 0), new Point2D(5, 0)))
    plan.addWall(new Wall(new Point2D(5, 0), new Point2D(5, 4)))
    expect(plan.floorPolygon()).toBeNull()
  })

  test('wallAt finds the wall nearest to a point within tolerance', () => {
    const plan = FloorPlan.rectangle(5, 4)
    const found = plan.wallAt(new Point2D(2.5, 0.05), 0.2)
    expect(found).not.toBeNull()
    expect(found!.start.equals(new Point2D(0, 0))).toBe(true)
    expect(plan.wallAt(new Point2D(2.5, 2), 0.2)).toBeNull()
  })
})
