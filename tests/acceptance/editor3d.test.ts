import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { Point2D } from '../../src/core/geometry/Point2D'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Project } from '../../src/core/model/Project'
import { Door } from '../../src/core/model/Door'
import { Window } from '../../src/core/model/Window'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { MoveOpeningCommand } from '../../src/app/commands/PlanCommands'
import { slideOffset, tryDropOpening } from '../../src/app/editor/OpeningDrag'
import { dropFurniture } from '../../src/app/editor/FurnitureDrop'

const catalog = new DefaultCatalog()

function roomWithWindow() {
  const project = new Project(FloorPlan.rectangle(5, 4))
  const wall = project.floorPlan.walls[0]!
  const window = new Window(1, 1.2)
  wall.addOpening(window)
  return { project, wall, window }
}

feature('3D-first editing', () => {
  scenario('Create a rectangular room from the menu', () => {
    const plan = FloorPlan.rectangle(4, 3, 2.6)
    expect(plan.walls).toHaveLength(4)
    for (const wall of plan.walls) expect(wall.height).toBe(2.6)
    expect(plan.floorPolygon()!.area()).toBeCloseTo(12)
  })

  scenario('Create an L-shaped room from the menu', () => {
    const plan = FloorPlan.lShape(5, 4, 2, 1.5)
    expect(plan.walls).toHaveLength(6)
    expect(plan.floorPolygon()!.area()).toBeCloseTo(17)
  })

  scenario('Dragging a window slides it along its wall', () => {
    const { project, wall, window } = roomWithWindow()
    const offset = slideOffset(wall, window, new Point2D(2.6, 0.3))
    project.moveOpening(wall, window, offset)
    expect(window.offset).toBeCloseTo(2.0)
  })

  scenario('A dragged window stops at the end of its wall', () => {
    const { wall, window } = roomWithWindow()
    expect(slideOffset(wall, window, new Point2D(99, 0))).toBeCloseTo(5 - 1.2)
    expect(slideOffset(wall, window, new Point2D(-99, 0))).toBe(0)
  })

  scenario('A window cannot be dropped over a door', () => {
    const { project, wall, window } = roomWithWindow()
    const door = new Door(2.5, 0.9)
    wall.addOpening(door)
    const overDoor = slideOffset(wall, window, new Point2D(2.9, 0))
    const dropped = tryDropOpening(project, wall, window, overDoor)
    expect(dropped).toBe(false)
    expect(window.offset).toBe(1)
  })

  scenario('Moving an opening is undoable', () => {
    const { project, wall, window } = roomWithWindow()
    const stack = new CommandStack()
    stack.execute(new MoveOpeningCommand(project, wall, window, 3))
    expect(window.offset).toBe(3)
    stack.undo()
    expect(window.offset).toBe(1)
  })

  scenario('Dropping furniture over a surface stacks it', () => {
    const project = new Project(FloorPlan.rectangle(5, 4))
    const table = project.placeFurniture(catalog.get('table'), 2, 2)
    const vase = project.placeFurniture(catalog.get('vase'), 0.5, 0.5)
    dropFurniture(project, vase, 2.1, 1.9)
    expect(vase.supportedBy).toBe(table)
    expect(vase.position.y).toBeCloseTo(catalog.get('table').height)
    expect(vase.position.x).toBeCloseTo(2.1)
    expect(vase.position.z).toBeCloseTo(1.9)
  })

  scenario('Dropping stacked furniture on empty floor releases it', () => {
    const project = new Project(FloorPlan.rectangle(5, 4))
    const table = project.placeFurniture(catalog.get('table'), 2, 2)
    const vase = project.placeOnTop(catalog.get('vase'), table)
    dropFurniture(project, vase, 0.5, 0.5)
    expect(vase.supportedBy).toBeUndefined()
    expect(vase.position.y).toBe(0)
    expect(vase.position.x).toBeCloseTo(0.5)
  })
})
