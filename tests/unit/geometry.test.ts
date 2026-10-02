import { describe, expect, test } from 'vitest'
import { Point2D } from '../../src/core/geometry/Point2D'
import { Point3D } from '../../src/core/geometry/Point3D'
import { Segment } from '../../src/core/geometry/Segment'
import { Polygon } from '../../src/core/geometry/Polygon'

describe('Point2D', () => {
  test('adds and subtracts', () => {
    const a = new Point2D(1, 2)
    const b = new Point2D(3, -1)
    expect(a.add(b)).toEqual(new Point2D(4, 1))
    expect(a.sub(b)).toEqual(new Point2D(-2, 3))
  })

  test('length and distance', () => {
    expect(new Point2D(3, 4).length()).toBe(5)
    expect(new Point2D(1, 1).distanceTo(new Point2D(4, 5))).toBe(5)
  })

  test('normalized has length 1 and keeps direction', () => {
    const n = new Point2D(10, 0).normalized()
    expect(n.x).toBeCloseTo(1)
    expect(n.y).toBeCloseTo(0)
    expect(n.length()).toBeCloseTo(1)
  })

  test('normalizing a zero vector throws', () => {
    expect(() => new Point2D(0, 0).normalized()).toThrow()
  })

  test('perpendicular is orthogonal', () => {
    const v = new Point2D(2, 5)
    expect(v.dot(v.perp())).toBeCloseTo(0)
  })

  test('scale multiplies both components', () => {
    expect(new Point2D(2, -3).scale(2)).toEqual(new Point2D(4, -6))
  })

  test('equals uses epsilon tolerance', () => {
    expect(new Point2D(1, 1).equals(new Point2D(1 + 1e-9, 1))).toBe(true)
    expect(new Point2D(1, 1).equals(new Point2D(1.1, 1))).toBe(false)
  })
})

describe('Point3D', () => {
  test('stores three coordinates and compares with epsilon', () => {
    const p = new Point3D(1, 2, 3)
    expect(p.x).toBe(1)
    expect(p.y).toBe(2)
    expect(p.z).toBe(3)
    expect(p.equals(new Point3D(1, 2, 3 + 1e-10))).toBe(true)
    expect(p.equals(new Point3D(1, 2, 4))).toBe(false)
  })
})

describe('Segment', () => {
  const seg = new Segment(new Point2D(0, 0), new Point2D(10, 0))

  test.each([
    [[5, -2, 5, 2], true], [[10, 0, 12, 2], true], [[3, 0, 7, 0], true],
    [[11, 0, 12, 0], false], [[-2, 0, -1, 0], false], [[3, 1, 7, 1], false],
    [[3, -1, 7, -1], false], [[5, 1, 5, 2], false],
  ] as [number[], boolean][])('intersection with %s is %s', (points, expected) => {
    const other = new Segment(new Point2D(points[0]!, points[1]!), new Point2D(points[2]!, points[3]!))
    expect(seg.intersects(other)).toBe(expected)
    expect(other.intersects(seg)).toBe(expected)
  })

  test('length and direction', () => {
    expect(seg.length()).toBe(10)
    expect(seg.direction().equals(new Point2D(1, 0))).toBe(true)
  })

  test('pointAtDistance interpolates along the segment', () => {
    expect(seg.pointAtDistance(4).equals(new Point2D(4, 0))).toBe(true)
  })

  test('projection parameter of a point, clamped to the segment', () => {
    expect(seg.projectDistance(new Point2D(3, 5))).toBeCloseTo(3)
    expect(seg.projectDistance(new Point2D(-4, 2))).toBe(0)
    expect(seg.projectDistance(new Point2D(99, 2))).toBe(10)
  })

  test('distance from a point to the segment', () => {
    expect(seg.distanceToPoint(new Point2D(5, 3))).toBeCloseTo(3)
    expect(seg.distanceToPoint(new Point2D(-3, 4))).toBeCloseTo(5)
  })
})

describe('Polygon', () => {
  test('area of a rectangle (shoelace), independent of winding', () => {
    const cw = new Polygon([
      new Point2D(0, 0),
      new Point2D(0, 4),
      new Point2D(5, 4),
      new Point2D(5, 0),
    ])
    const ccw = new Polygon([...cw.vertices].reverse())
    expect(cw.area()).toBeCloseTo(20)
    expect(ccw.area()).toBeCloseTo(20)
  })

  test('contains points inside, excludes points outside', () => {
    const rect = new Polygon([
      new Point2D(0, 0),
      new Point2D(5, 0),
      new Point2D(5, 4),
      new Point2D(0, 4),
    ])
    expect(rect.contains(new Point2D(2, 2))).toBe(true)
    expect(rect.contains(new Point2D(6, 2))).toBe(false)
  })
})
