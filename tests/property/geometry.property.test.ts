import { describe, test } from 'vitest'
import fc from 'fast-check'
import { Point2D } from '../../src/core/geometry/Point2D'
import { Segment } from '../../src/core/geometry/Segment'
import { Polygon } from '../../src/core/geometry/Polygon'

const coord = fc.double({ min: -50, max: 50, noNaN: true })
const point = fc.record({ x: coord, y: coord }).map(({ x, y }) => new Point2D(x, y))

const segment = fc
  .tuple(point, point)
  .filter(([a, b]) => a.distanceTo(b) > 0.01)
  .map(([a, b]) => new Segment(a, b))

describe('Propiedades de Segment', () => {
  test('projectDistance siempre cae en [0, length]', () => {
    fc.assert(
      fc.property(segment, point, (s, p) => {
        const d = s.projectDistance(p)
        return d >= 0 && d <= s.length() + 1e-9
      }),
    )
  })

  test('el punto proyectado es el más cercano del segmento (muestreo)', () => {
    fc.assert(
      fc.property(segment, point, fc.double({ min: 0, max: 1, noNaN: true }), (s, p, t) => {
        const nearest = s.pointAtDistance(s.projectDistance(p))
        const sampled = s.pointAtDistance(t * s.length())
        return nearest.distanceTo(p) <= sampled.distanceTo(p) + 1e-6
      }),
    )
  })

  test('distanceToPoint nunca es negativa y es 0 para puntos del segmento', () => {
    fc.assert(
      fc.property(segment, fc.double({ min: 0, max: 1, noNaN: true }), (s, t) => {
        const onSegment = s.pointAtDistance(t * s.length())
        return s.distanceToPoint(onSegment) < 1e-6
      }),
    )
  })
})

describe('Propiedades de Polygon', () => {
  test('el área de un rectángulo w×h es w·h, con cualquier origen y sentido', () => {
    fc.assert(
      fc.property(
        coord,
        coord,
        fc.double({ min: 0.1, max: 40, noNaN: true }),
        fc.double({ min: 0.1, max: 40, noNaN: true }),
        fc.boolean(),
        (ox, oy, w, h, reverse) => {
          const corners = [
            new Point2D(ox, oy),
            new Point2D(ox + w, oy),
            new Point2D(ox + w, oy + h),
            new Point2D(ox, oy + h),
          ]
          const polygon = new Polygon(reverse ? corners.reverse() : corners)
          return Math.abs(polygon.area() - w * h) < 1e-6
        },
      ),
    )
  })

  test('el centro de un rectángulo siempre está contenido', () => {
    fc.assert(
      fc.property(
        coord,
        coord,
        fc.double({ min: 0.1, max: 40, noNaN: true }),
        fc.double({ min: 0.1, max: 40, noNaN: true }),
        (ox, oy, w, h) => {
          const polygon = new Polygon([
            new Point2D(ox, oy),
            new Point2D(ox + w, oy),
            new Point2D(ox + w, oy + h),
            new Point2D(ox, oy + h),
          ])
          return polygon.contains(new Point2D(ox + w / 2, oy + h / 2))
        },
      ),
    )
  })
})
