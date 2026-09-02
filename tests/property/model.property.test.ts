import { describe, test, expect } from 'vitest'
import fc from 'fast-check'
import { Point2D } from '../../src/core/geometry/Point2D'
import { Wall } from '../../src/core/model/Wall'
import { Door } from '../../src/core/model/Door'
import { Window } from '../../src/core/model/Window'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Project } from '../../src/core/model/Project'
import { CeilingLight, FloorLamp, WallLight } from '../../src/core/model/LightPoint'
import { Sun } from '../../src/core/model/Sun'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { serializeProject, deserializeProject } from '../../src/app/serialization/ProjectSerializer'

const catalog = new DefaultCatalog()

describe('Propiedades de Wall y aperturas', () => {
  test('tras cualquier secuencia de inserciones válidas, las aperturas nunca se solapan', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            offset: fc.double({ min: 0, max: 9, noNaN: true }),
            width: fc.double({ min: 0.3, max: 2, noNaN: true }),
            isDoor: fc.boolean(),
          }),
          { maxLength: 12 },
        ),
        (attempts) => {
          const wall = new Wall(new Point2D(0, 0), new Point2D(10, 0))
          for (const a of attempts) {
            try {
              wall.addOpening(a.isDoor ? new Door(a.offset, a.width) : new Window(a.offset, a.width))
            } catch {
              // rechazada: fuera de límites o solapada
            }
          }
          const sorted = [...wall.openings].sort((x, y) => x.offset - y.offset)
          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i]!.offset < sorted[i - 1]!.end) return false
          }
          return sorted.every((o) => o.offset >= 0 && o.end <= wall.length())
        },
      ),
    )
  })

  test('el centro mundial de una apertura está siempre sobre su pared', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 8, noNaN: true }),
        fc.double({ min: 0.3, max: 2, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        (offset, width, ex, ey) => {
          fc.pre(Math.hypot(ex, ey) > 10.5)
          const wall = new Wall(new Point2D(0, 0), new Point2D(ex, ey))
          fc.pre(offset + width <= wall.length())
          const door = new Door(offset, width)
          wall.addOpening(door)
          return wall.segment().distanceToPoint(wall.worldCenterOf(door)) < 1e-6
        },
      ),
    )
  })
})

describe('Propiedades del apilado', () => {
  test('mover el soporte preserva las alturas y desplaza toda la pila junta', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (x0, z0, x1, z1) => {
          const p = new Project(FloorPlan.rectangle(30, 30))
          const table = p.placeFurniture(catalog.get('table'), x0, z0)
          const vase = p.placeOnTop(catalog.get('vase'), table)
          const heightBefore = vase.position.y
          p.moveFurniture(table, x1, z1)
          return (
            Math.abs(vase.position.x - x1) < 1e-9 &&
            Math.abs(vase.position.z - z1) < 1e-9 &&
            vase.position.y === heightBefore
          )
        },
      ),
    )
  })

  test('containsPlanPoint: el centro siempre pertenece a la huella, gire lo que gire', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -Math.PI * 2, max: Math.PI * 2, noNaN: true }),
        fc.constantFrom('sofa', 'table', 'bed', 'rug', 'vase'),
        (x, z, angle, itemId) => {
          const p = new Project(FloorPlan.rectangle(30, 30))
          const f = p.placeFurniture(catalog.get(itemId), x, z)
          p.rotateFurniture(f, angle)
          return f.containsPlanPoint(new Point2D(x, z))
        },
      ),
    )
  })
})

describe('Propiedades de las luces y el sol', () => {
  test('setIntensity/setTemperature siempre dejan valores dentro de rango', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, min: -1e6, max: 1e6 }),
        fc.double({ noNaN: true, min: -1e6, max: 1e6 }),
        (intensity, kelvin) => {
          const light = new CeilingLight(0, 0, 2.5)
          light.setIntensity(intensity)
          light.setTemperature(kelvin)
          return (
            light.intensity >= 0 &&
            light.intensity <= 1 &&
            light.temperatureK >= 2000 &&
            light.temperatureK <= 6500
          )
        },
      ),
    )
  })

  test('la altitud del sol está acotada y es 0 de noche', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 24, noNaN: true }), (t) => {
        const altitude = Sun.altitude(t)
        if (t <= 6 || t >= 18) return altitude === 0
        return altitude > 0 && altitude <= Math.PI / 3 + 1e-9
      }),
    )
  })
})

describe('Propiedad de round-trip de serialización', () => {
  const lightArb = fc
    .record({
      kind: fc.constantFrom('ceiling', 'wall', 'floor'),
      x: fc.double({ min: 0, max: 10, noNaN: true }),
      z: fc.double({ min: 0, max: 8, noNaN: true }),
      on: fc.boolean(),
      intensity: fc.double({ min: 0, max: 1, noNaN: true }),
      kelvin: fc.double({ min: 2000, max: 6500, noNaN: true }),
    })

  test('cualquier proyecto generado sobrevive idéntico a serializar + cargar', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 3, max: 12, noNaN: true }),
        fc.double({ min: 3, max: 12, noNaN: true }),
        fc.array(
          fc.record({
            itemId: fc.constantFrom('sofa', 'table', 'chair', 'bed', 'vase', 'rug'),
            x: fc.double({ min: 0.5, max: 2.5, noNaN: true }),
            z: fc.double({ min: 0.5, max: 2.5, noNaN: true }),
            rotation: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
            stackOnPrevSurface: fc.boolean(),
          }),
          { maxLength: 8 },
        ),
        fc.array(lightArb, { maxLength: 5 }),
        fc.double({ min: 0, max: 23.9, noNaN: true }),
        (width, depth, furniturePlan, lights, time) => {
          const p = new Project(FloorPlan.rectangle(width, depth))
          p.floorPlan.walls[0]!.addOpening(new Door(0.5, 0.9))
          p.floorPlan.walls[1]!.addOpening(new Window(0.5, 1.0))
          p.setTimeOfDay(time)

          for (const spec of furniturePlan) {
            const item = catalog.get(spec.itemId)
            const lastSurface = [...p.furniture].reverse().find((f) => f.item.isSurface)
            const f =
              spec.stackOnPrevSurface && lastSurface && lastSurface.item.id !== item.id
                ? p.placeOnTop(item, lastSurface)
                : p.placeFurniture(item, spec.x, spec.z)
            p.rotateFurniture(f, spec.rotation)
          }
          for (const spec of lights) {
            const light =
              spec.kind === 'ceiling'
                ? new CeilingLight(spec.x, spec.z, p.ceilingHeight)
                : spec.kind === 'wall'
                  ? new WallLight(spec.x, spec.z)
                  : new FloorLamp(spec.x, spec.z)
            light.on = spec.on
            light.setIntensity(spec.intensity)
            light.setTemperature(spec.kelvin)
            p.addLight(light)
          }

          const doc = serializeProject(p)
          const restored = deserializeProject(JSON.parse(JSON.stringify(doc)), catalog)
          expect(serializeProject(restored)).toEqual(doc)
        },
      ),
      { numRuns: 50 },
    )
  })
})
