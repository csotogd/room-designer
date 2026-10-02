import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { Point2D } from '../../src/core/geometry/Point2D'
import { Wall } from '../../src/core/model/Wall'
import { Door } from '../../src/core/model/Door'
import { Window } from '../../src/core/model/Window'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Project } from '../../src/core/model/Project'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { OpeningResize } from '../../src/app/editor/OpeningResize'
import { serializeProject, deserializeProject } from '../../src/app/serialization/ProjectSerializer'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'

const wall = () => new Wall(new Point2D(0, 0), new Point2D(5, 0))

function roomWithDoor() {
  const project = new Project(FloorPlan.rectangle(5, 4))
  const wall = project.floorPlan.walls[0]!
  const door = new Door(1, 0.9)
  project.addOpening(wall, door)
  const stack = new CommandStack()
  return { project, wall, door, stack, resize: new OpeningResize(project, wall, door, stack) }
}

feature('Doors and windows', () => {
  scenario('Resize a door dynamically and undo the gesture', () => {
    const { door, wall, stack, resize } = roomWithDoor()
    resize.preview(1.2)
    expect(door.width).toBe(1.2)
    resize.preview(1.8)
    resize.commit()
    expect(door.width).toBe(1.8)
    expect(door.offset).toBe(1)
    expect(wall.openings[0]).toBe(door)
    stack.undo()
    expect(door.width).toBe(0.9)
    expect(stack.canUndo()).toBe(false)
    stack.redo()
    expect(door.width).toBe(1.8)
  })

  scenario('Resizing an opening respects its neighbors and wall ends', () => {
    const { project, wall, door, resize } = roomWithDoor()
    const window = new Window(3, 1)
    project.addOpening(wall, window)
    resize.preview(99)
    resize.commit()
    expect(door.end).toBe(window.offset)
    project.removeOpening(wall, window)
    resize.preview(99)
    resize.commit()
    expect(door.end).toBe(wall.length())
  })

  scenario('Custom opening widths survive saving and loading', () => {
    const { project, wall, resize } = roomWithDoor()
    resize.preview(1.5)
    resize.commit()
    const window = new Window(3, 1)
    project.addOpening(wall, window)
    project.resizeOpening(wall, window, 1.7)
    const restored = deserializeProject(serializeProject(project), new DefaultCatalog())
    expect(restored.floorPlan.walls[0]!.openings.map(o => [o.kind, o.offset, o.width])).toEqual([
      ['door', 1, 1.5], ['window', 3, 1.7],
    ])
  })

  scenario('Place a door on a wall', () => {
    const w = wall()
    const door = new Door(1, 0.9)
    w.addOpening(door)
    expect(w.openings).toHaveLength(1)
    expect(w.worldCenterOf(door).equals(new Point2D(1.45, 0))).toBe(true)
  })

  scenario('Place a window with sill height', () => {
    const w = wall()
    const window = new Window(2, 1.2, 1.1, 0.9)
    w.addOpening(window)
    expect(w.openings).toHaveLength(1)
    expect(window.sillHeight).toBe(0.9)
  })

  scenario('An opening cannot extend beyond its wall', () => {
    expect(() => wall().addOpening(new Door(4.5, 0.9))).toThrow()
  })

  scenario('Openings cannot overlap on the same wall', () => {
    const w = wall()
    w.addOpening(new Door(1, 0.9))
    expect(() => w.addOpening(new Window(1.5, 1.2, 1.1, 0.9))).toThrow()
  })

  scenario('Openings follow their wall when it moves', () => {
    const w = wall()
    const door = new Door(1, 0.9)
    w.addOpening(door)
    w.moveTo(new Point2D(0, 0), new Point2D(0, 5))
    expect(w.worldCenterOf(door).equals(new Point2D(0, 1.45))).toBe(true)
  })
})
