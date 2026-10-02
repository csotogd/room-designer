import { describe, expect, test, vi } from 'vitest'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Project } from '../../src/core/model/Project'
import { Door } from '../../src/core/model/Door'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { ResizeOpeningCommand } from '../../src/app/commands/PlanCommands'
import { OpeningResize } from '../../src/app/editor/OpeningResize'

function setup() {
  const project = new Project(FloorPlan.rectangle(5, 4))
  const wall = project.floorPlan.walls[0]!
  const door = new Door(1, 0.9)
  project.addOpening(wall, door)
  const stack = new CommandStack()
  return { project, wall, door, stack, resize: new OpeningResize(project, wall, door, stack) }
}

describe('Opening resize', () => {
  test('project notifies views only after a valid resize', () => {
    const { project, wall, door } = setup()
    const changed = vi.fn()
    project.events.on('changed', changed)
    project.resizeOpening(wall, door, 2)
    expect(door.width).toBe(2)
    expect(changed).toHaveBeenCalledExactlyOnceWith({ kind: 'opening-resized' })
    expect(() => project.resizeOpening(wall, door, 99)).toThrow()
    expect(changed).toHaveBeenCalledTimes(1)
  })

  test('a width command restores the prior width and replays the new one', () => {
    const { project, wall, door, stack } = setup()
    stack.execute(new ResizeOpeningCommand(project, wall, door, 1.4))
    expect(door.width).toBe(1.4)
    stack.undo()
    expect(door.width).toBe(0.9)
    stack.redo()
    expect(door.width).toBe(1.4)
  })

  test('preview clamps to 30 cm and available wall space', () => {
    const { door, resize, stack } = setup()
    resize.preview(-8)
    expect(door.width).toBe(0.3)
    resize.preview(100)
    expect(door.width).toBe(4)
    expect(stack.canUndo()).toBe(false)
    resize.commit()
    stack.undo()
    expect(door.width).toBe(0.9)
  })

  test('each gesture captures the current width, including after undo', () => {
    const { door, resize, stack } = setup()
    resize.preview(1.5)
    resize.commit()
    stack.undo()
    resize.preview(2)
    resize.commit()
    stack.undo()
    expect(door.width).toBe(0.9)
    stack.redo()
    resize.preview(2.5)
    resize.commit()
    stack.undo()
    expect(door.width).toBe(2)
  })

  test('unchanged and nonfinite values create no history', () => {
    const { resize, stack, door } = setup()
    resize.commit()
    resize.preview(NaN)
    resize.preview(Infinity)
    resize.preview(0.9)
    resize.commit()
    expect(door.width).toBe(0.9)
    expect(stack.canUndo()).toBe(false)
  })

  test('cancel restores the start and allows a new gesture', () => {
    const { resize, stack, door } = setup()
    resize.cancel()
    resize.preview(2)
    resize.cancel()
    expect(door.width).toBe(0.9)
    expect(stack.canUndo()).toBe(false)
    resize.preview(1.5)
    resize.commit()
    stack.undo()
    expect(door.width).toBe(0.9)
  })

  test('legacy openings narrower than 30 cm can still use their available space', () => {
    const { wall, project, stack } = setup()
    const door = new Door(4.8, 0.1)
    wall.addOpening(door)
    const resize = new OpeningResize(project, wall, door, stack)
    resize.preview(1)
    expect(door.width).toBeCloseTo(0.2)
  })
})
