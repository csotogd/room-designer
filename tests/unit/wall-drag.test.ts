import { expect, test, vi } from 'vitest'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Point2D } from '../../src/core/geometry/Point2D'
import { WallDrag } from '../../src/app/editor/WallDrag'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'

function setup(mode: 'move' | 'start' | 'end' = 'move') {
  const project = new Project(FloorPlan.rectangle(5, 4))
  const wall = project.floorPlan.walls[1]!
  const stack = new CommandStack()
  const grab = mode === 'move' ? new Point2D(5, 2) : wall[mode]
  return { project, wall, stack, drag: new WallDrag(project, wall, mode, grab, stack) }
}

test('wall gestures preview only perpendicular movement and notify the views', () => {
  const { project, wall, drag } = setup()
  const changed = vi.fn()
  project.events.on('changed', changed)
  expect(drag.preview(new Point2D(6, 3))).toBe(true)
  expect(wall.start).toEqual(new Point2D(6, 0))
  expect(wall.end).toEqual(new Point2D(6, 4))
  expect(changed).toHaveBeenCalledExactlyOnceWith({ kind: 'wall-reshaped' })
  expect(drag.preview(new Point2D(7, 9))).toBe(true)
  expect(wall.start).toEqual(new Point2D(7, 0))
})

test.each(['start', 'end'] as const)('the %s corner follows the pointer and keeps the opposite end', mode => {
  const { wall, drag, stack } = setup(mode)
  const before = wall[mode]
  const opposite = wall[mode === 'start' ? 'end' : 'start']
  const target = before.add(new Point2D(1, 0))
  expect(drag.preview(target)).toBe(true)
  drag.commit()
  expect(wall[mode]).toEqual(target)
  expect(wall[mode === 'start' ? 'end' : 'start']).toBe(opposite)
  stack.undo()
  expect(wall[mode]).toEqual(before)
  stack.redo()
  expect(wall[mode]).toEqual(target)
})

test('invalid positions keep the last valid preview and do not emit changes', () => {
  const { project, wall, drag } = setup()
  drag.preview(new Point2D(6, 2))
  const changed = vi.fn()
  project.events.on('changed', changed)
  expect(drag.preview(new Point2D(-1, 2))).toBe(false)
  expect(drag.preview(new Point2D(Infinity, 2))).toBe(false)
  expect(wall.start.x).toBe(6)
  expect(changed).not.toHaveBeenCalled()
})

test('shrinking across furniture is rejected even when all openings fit', () => {
  const { project, wall, drag } = setup()
  project.placeFurniture(new DefaultCatalog().get('table'), 4, 2)
  expect(drag.preview(new Point2D(3, 2))).toBe(false)
  expect(wall.start.x).toBe(5)
})

test('a click or canceled gesture leaves no history entry', () => {
  const { wall, stack, drag } = setup()
  drag.commit()
  expect(stack.canUndo()).toBe(false)
  drag.preview(new Point2D(7, 2))
  drag.cancel()
  expect(wall.start.x).toBe(5)
  expect(stack.canUndo()).toBe(false)
})

test('grabbing near a corner preserves the pointer offset without a jump', () => {
  const { project, wall, stack } = setup()
  const drag = new WallDrag(project, wall, 'start', new Point2D(5.1, 0.1), stack)
  expect(drag.preview(new Point2D(6.1, 0.1))).toBe(true)
  expect(wall.start).toEqual(new Point2D(6, 0))
})
