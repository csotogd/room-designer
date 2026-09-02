import { describe, expect, test } from 'vitest'
import { Point2D } from '../../src/core/geometry/Point2D'
import { Point3D } from '../../src/core/geometry/Point3D'
import { Polygon } from '../../src/core/geometry/Polygon'
import { Wall } from '../../src/core/model/Wall'
import { Door } from '../../src/core/model/Door'
import { Window } from '../../src/core/model/Window'
import { Furniture } from '../../src/core/model/Furniture'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Project } from '../../src/core/model/Project'
import { Sun } from '../../src/core/model/Sun'
import { CeilingLight } from '../../src/core/model/LightPoint'
import { EventEmitter } from '../../src/core/events/EventEmitter'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { AddWallCommand, RemoveWallCommand, AddOpeningCommand } from '../../src/app/commands/PlanCommands'
import { AddLightCommand, RemoveLightCommand } from '../../src/app/commands/LightCommands'
import { MoveFurnitureCommand, RotateFurnitureCommand } from '../../src/app/commands/FurnitureCommands'
import { RemoveFurnitureCommand } from '../../src/app/commands/RemoveFurnitureCommand'
import { PlaceOnTopCommand } from '../../src/app/commands/PlaceFurnitureCommand'

const catalog = new DefaultCatalog()
const item = (id: string) => catalog.get(id)
const room = () => new Project(FloorPlan.rectangle(5, 4))

describe('Comandos de plano', () => {
  test('AddWallCommand añade y su undo elimina exactamente esa pared', () => {
    const p = room()
    const stack = new CommandStack()
    const wall = new Wall(new Point2D(0, 0), new Point2D(2, 0))
    stack.execute(new AddWallCommand(p, wall))
    expect(p.floorPlan.walls).toContain(wall)
    stack.undo()
    expect(p.floorPlan.walls).not.toContain(wall)
    expect(p.floorPlan.walls).toHaveLength(4)
  })

  test('RemoveWallCommand con undo restaura la pared y sus aperturas', () => {
    const p = room()
    const stack = new CommandStack()
    const wall = p.floorPlan.walls[0]!
    wall.addOpening(new Door(1, 0.9))
    stack.execute(new RemoveWallCommand(p, wall))
    expect(p.floorPlan.walls).toHaveLength(3)
    stack.undo()
    expect(p.floorPlan.walls).toHaveLength(4)
    expect(p.floorPlan.openings()).toHaveLength(1)
  })

  test('AddOpeningCommand con undo deja la pared limpia', () => {
    const p = room()
    const stack = new CommandStack()
    const wall = p.floorPlan.walls[0]!
    stack.execute(new AddOpeningCommand(p, wall, new Window(1, 1.2)))
    expect(wall.openings).toHaveLength(1)
    stack.undo()
    expect(wall.openings).toHaveLength(0)
  })
})

describe('Comandos de luces', () => {
  test('AddLightCommand / RemoveLightCommand con undo y redo', () => {
    const p = room()
    const stack = new CommandStack()
    const light = new CeilingLight(2, 2, p.ceilingHeight)
    stack.execute(new AddLightCommand(p, light))
    expect(p.lights).toContain(light)
    stack.undo()
    expect(p.lights).toHaveLength(0)
    stack.redo()
    stack.execute(new RemoveLightCommand(p, light))
    expect(p.lights).toHaveLength(0)
    stack.undo()
    expect(p.lights).toContain(light)
  })
})

describe('Mover luces', () => {
  test('moveLight cambia la posición y MoveLightCommand lo deshace', async () => {
    const { MoveLightCommand } = await import('../../src/app/commands/LightCommands')
    const p = room()
    const light = new CeilingLight(1, 1, p.ceilingHeight)
    p.addLight(light)
    const stack = new CommandStack()
    stack.execute(new MoveLightCommand(p, light, new Point3D(3, p.ceilingHeight, 2)))
    expect(light.position.x).toBe(3)
    stack.undo()
    expect(light.position.x).toBe(1)
    expect(light.position.y).toBe(p.ceilingHeight)
  })
})

describe('Comandos de muebles', () => {
  test('MoveFurnitureCommand mueve la pila entera y el undo la devuelve', () => {
    const p = room()
    const stack = new CommandStack()
    const table = p.placeFurniture(item('table'), 2, 2)
    const vase = p.placeOnTop(item('vase'), table)
    stack.execute(new MoveFurnitureCommand(p, table, 4, 3))
    expect(table.position.x).toBe(4)
    expect(vase.position.x).toBe(4)
    expect(vase.position.z).toBe(3)
    stack.undo()
    expect(table.position.x).toBe(2)
    expect(vase.position.x).toBe(2)
    expect(vase.position.y).toBeCloseTo(item('table').height)
  })

  test('RotateFurnitureCommand y su undo restauran el ángulo original', () => {
    const p = room()
    const stack = new CommandStack()
    const sofa = p.placeFurniture(item('sofa'), 1, 1)
    p.rotateFurniture(sofa, 0.5)
    stack.execute(new RotateFurnitureCommand(p, sofa, 1.25))
    expect(sofa.rotationY).toBe(1.25)
    stack.undo()
    expect(sofa.rotationY).toBe(0.5)
  })

  test('RemoveFurnitureCommand + undo restaura el jarrón encima de la mesa', () => {
    const p = room()
    const stack = new CommandStack()
    const table = p.placeFurniture(item('table'), 2, 2)
    const vase = p.placeOnTop(item('vase'), table)
    stack.execute(new RemoveFurnitureCommand(p, table))
    expect(p.furniture).not.toContain(table)
    expect(vase.position.y).toBe(0)
    expect(vase.supportedBy).toBeUndefined()
    stack.undo()
    expect(p.furniture).toContain(table)
    expect(vase.supportedBy).toBe(table)
    expect(vase.position.y).toBeCloseTo(item('table').height)
  })

  test('PlaceOnTopCommand: undo y redo mantienen el apoyo', () => {
    const p = room()
    const stack = new CommandStack()
    const table = p.placeFurniture(item('table'), 2, 2)
    const command = new PlaceOnTopCommand(p, item('vase'), table)
    stack.execute(command)
    const vase = command.placed()!
    stack.undo()
    expect(p.furniture).not.toContain(vase)
    stack.redo()
    expect(p.furniture).toContain(vase)
    expect(vase.supportedBy).toBe(table)
  })
})

describe('Sol: azimut y bordes', () => {
  test('el azimut barre de este (-π/2) a oeste (+π/2)', () => {
    expect(Sun.azimuth(6)).toBeCloseTo(-Math.PI / 2)
    expect(Sun.azimuth(12)).toBeCloseTo(0)
    expect(Sun.azimuth(18)).toBeCloseTo(Math.PI / 2)
  })

  test('la altitud a mediodía es exactamente la máxima (π/3)', () => {
    expect(Sun.altitude(12)).toBeCloseTo(Math.PI / 3)
  })

  test('la altitud crece de 7 a 12 y decrece de 12 a 17', () => {
    expect(Sun.altitude(9)).toBeGreaterThan(Sun.altitude(7))
    expect(Sun.altitude(12)).toBeGreaterThan(Sun.altitude(9))
    expect(Sun.altitude(15)).toBeLessThan(Sun.altitude(12))
  })
})

describe('Valores por defecto de aperturas', () => {
  test('una puerta mide 2.0 de alto y arranca del suelo', () => {
    const door = new Door(0, 0.9)
    expect(door.height).toBe(2.0)
    expect(door.sillHeight).toBe(0)
    expect(door.kind).toBe('door')
  })

  test('una ventana por defecto: alto 1.1, antepecho 0.9', () => {
    const window = new Window(0, 1.2)
    expect(window.height).toBe(1.1)
    expect(window.sillHeight).toBe(0.9)
    expect(window.kind).toBe('window')
  })

  test('overlaps: adyacentes no solapan, contenidas sí', () => {
    const a = new Door(1, 1)
    expect(a.overlaps(new Door(2, 1))).toBe(false)
    expect(a.overlaps(new Door(0, 1))).toBe(false)
    expect(a.overlaps(new Door(1.2, 0.4))).toBe(true)
    expect(a.overlaps(new Door(0.5, 1))).toBe(true)
    expect(a.end).toBe(2)
  })
})

describe('Furniture directo', () => {
  test('topY, supportChain a dos niveles y rotationYDegrees', () => {
    const p = new Project(FloorPlan.rectangle(10, 10))
    const table = p.placeFurniture(item('table'), 2, 2)
    const shelf = p.placeOnTop(item('shelf'), table)
    const vase = p.placeOnTop(item('vase'), shelf)
    expect(table.topY()).toBeCloseTo(0.75)
    expect(shelf.topY()).toBeCloseTo(0.75 + 1.8)
    expect(vase.supportChain()).toEqual([shelf, table])
    expect(new Furniture(item('sofa'), new Point3D(0, 0, 0), Math.PI).rotationYDegrees()).toBe(180)
  })

  test('containsPlanPoint en el borde exacto de la huella', () => {
    const sofa = new Furniture(item('sofa'), new Point3D(0, 0, 0)) // 2.0 × 0.9
    expect(sofa.containsPlanPoint(new Point2D(1.0, 0))).toBe(true)
    expect(sofa.containsPlanPoint(new Point2D(1.0001, 0))).toBe(false)
    expect(sofa.containsPlanPoint(new Point2D(0, 0.45))).toBe(true)
    expect(sofa.containsPlanPoint(new Point2D(0, 0.4501))).toBe(false)
  })
})

describe('Polygon: bordes', () => {
  test('rechaza menos de 3 vértices', () => {
    expect(() => new Polygon([new Point2D(0, 0), new Point2D(1, 0)])).toThrow()
  })

  test('área de un triángulo', () => {
    const t = new Polygon([new Point2D(0, 0), new Point2D(4, 0), new Point2D(0, 3)])
    expect(t.area()).toBeCloseTo(6)
  })

  test('un punto justo fuera del borde no está contenido', () => {
    const rect = new Polygon([
      new Point2D(0, 0),
      new Point2D(5, 0),
      new Point2D(5, 4),
      new Point2D(0, 4),
    ])
    expect(rect.contains(new Point2D(5.01, 2))).toBe(false)
    expect(rect.contains(new Point2D(-0.01, 2))).toBe(false)
    expect(rect.contains(new Point2D(2, 4.01))).toBe(false)
  })
})

describe('Catálogo: invariantes', () => {
  test('ids únicos, dimensiones positivas y superficies esperadas', () => {
    const items = catalog.items()
    const ids = items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const i of items) {
      expect(i.width).toBeGreaterThan(0)
      expect(i.depth).toBeGreaterThan(0)
      expect(i.height).toBeGreaterThan(0)
      expect(i.name.length).toBeGreaterThan(0)
      expect(i.price).toBeGreaterThan(0)
    }
    const surfaces = items.filter((i) => i.isSurface).map((i) => i.id).sort()
    expect(surfaces).toEqual([
      'bed',
      'bench',
      'bookcase',
      'coffee-table',
      'desk',
      'dresser',
      'nightstand',
      'shelf',
      'sideboard',
      'table',
      'wardrobe',
    ])
  })

  test('get devuelve el mismo objeto listado y falla con id desconocido', () => {
    expect(catalog.get('sofa')).toBe(catalog.items().find((i) => i.id === 'sofa'))
    expect(() => catalog.get('nope')).toThrow(/desconocido/i)
  })
})

describe('EventEmitter', () => {
  test('la desuscripción detiene la entrega; emitir sin oyentes es seguro', () => {
    const emitter = new EventEmitter<{ ping: number }>()
    let received = 0
    const off = emitter.on('ping', (n) => void (received += n))
    emitter.emit('ping', 2)
    off()
    emitter.emit('ping', 5)
    expect(received).toBe(2)
    expect(() => emitter.emit('ping', 1)).not.toThrow()
  })

  test('varios oyentes reciben el mismo evento', () => {
    const emitter = new EventEmitter<{ ping: number }>()
    const log: string[] = []
    emitter.on('ping', () => log.push('a'))
    emitter.on('ping', () => log.push('b'))
    emitter.emit('ping', 1)
    expect(log).toEqual(['a', 'b'])
  })
})

describe('Wall: bordes restantes', () => {
  test('una pared no puede encoger por debajo de sus aperturas', () => {
    const wall = new Wall(new Point2D(0, 0), new Point2D(5, 0))
    wall.addOpening(new Door(3.5, 0.9))
    expect(() => wall.moveTo(new Point2D(0, 0), new Point2D(4, 0))).toThrow(/encoger|caben/i)
    // La pared queda intacta tras el rechazo
    expect(wall.length()).toBe(5)
    expect(wall.openings).toHaveLength(1)
  })

  test('una apertura exactamente del ancho de la pared es válida', () => {
    const wall = new Wall(new Point2D(0, 0), new Point2D(2, 0))
    expect(() => wall.addOpening(new Window(0, 2))).not.toThrow()
  })
})

describe('Project: eventos con tipo correcto', () => {
  test('cada mutación emite su kind', () => {
    const p = room()
    const kinds: string[] = []
    p.events.on('changed', (e) => kinds.push(e.kind))
    const sofa = p.placeFurniture(item('sofa'), 1, 1)
    p.rotateFurniture(sofa, 1)
    p.moveFurniture(sofa, 2, 2)
    p.removeFurniture(sofa)
    p.setTimeOfDay(10)
    expect(kinds).toEqual([
      'furniture-added',
      'furniture-rotated',
      'furniture-moved',
      'furniture-removed',
      'time-changed',
    ])
  })
})
