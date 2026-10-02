import { expect } from 'vitest'
import { scenario } from './gherkin'
import { Point2D } from '../../src/core/geometry/Point2D'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Project } from '../../src/core/model/Project'
import { Door } from '../../src/core/model/Door'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { WallDrag } from '../../src/app/editor/WallDrag'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'

function room() {
  const project = new Project(FloorPlan.rectangle(5, 4))
  const stack = new CommandStack()
  const wall = project.floorPlan.walls[1]!
  return { project, stack, wall, drag: new WallDrag(project, wall, 'move', new Point2D(5, 2), stack) }
}

scenario('Drag a wall to expand the room directly', () => {
  const { project, wall, drag } = room()
  const door = new Door(1, 0.9)
  project.addOpening(wall, door)
  expect(drag.preview(new Point2D(7, 3))).toBe(true)
  drag.commit()
  expect(project.floorPlan.floorPolygon()!.area()).toBe(28)
  expect(wall.start).toEqual(new Point2D(7, 0))
  expect(wall.end).toEqual(new Point2D(7, 4))
  expect(wall.openings[0]).toBe(door)
  expect(door.width).toBe(0.9)
})

scenario('Drag a wall endpoint to change its length', () => {
  const { project, stack } = room()
  const wall = project.floorPlan.walls[0]!
  const drag = new WallDrag(project, wall, 'end', wall.end, stack)
  drag.preview(new Point2D(6, 0))
  drag.commit()
  expect(wall.length()).toBe(6)
  expect(project.floorPlan.walls[1]!.start).toEqual(wall.end)
  expect(project.floorPlan.floorPolygon()).not.toBeNull()
})

scenario('A wall drag is one undoable gesture', () => {
  const { project, stack, drag } = room()
  drag.preview(new Point2D(6, 2))
  drag.preview(new Point2D(7, 2))
  drag.commit()
  expect(project.floorPlan.floorPolygon()!.area()).toBe(28)
  stack.undo()
  expect(project.floorPlan.floorPolygon()!.area()).toBe(20)
  expect(stack.canUndo()).toBe(false)
  stack.redo()
  expect(project.floorPlan.floorPolygon()!.area()).toBe(28)
})

scenario('Invalid wall drags preserve the last valid room', () => {
  const { project, drag } = room()
  project.placeFurniture(new DefaultCatalog().get('table'), 3.5, 2)
  project.addOpening(project.floorPlan.walls[0]!, new Door(4, 0.9))
  expect(drag.preview(new Point2D(4.5, 2))).toBe(false)
  expect(drag.preview(new Point2D(-1, 2))).toBe(false)
  expect(project.floorPlan.floorPolygon()!.area()).toBe(20)
})

scenario('Canceling a wall drag restores the original room', () => {
  const { project, stack, drag } = room()
  drag.preview(new Point2D(7, 2))
  drag.cancel()
  expect(project.floorPlan.floorPolygon()!.area()).toBe(20)
  expect(stack.canUndo()).toBe(false)
})
