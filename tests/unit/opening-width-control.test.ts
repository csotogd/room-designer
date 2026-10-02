// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Door } from '../../src/core/model/Door'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { OpeningWidthControl } from '../../src/ui/panels/OpeningWidthControl'

test('the width controls preview, commit, cancel and follow undo', () => {
  const project = new Project(FloorPlan.rectangle(5, 4))
  const wall = project.floorPlan.walls[0]!
  const door = new Door(1, 0.9)
  wall.addOpening(door)
  const stack = new CommandStack()
  const control = new OpeningWidthControl(document, project, wall, door, stack)
  document.body.replaceChildren(control.element)
  const slider = document.querySelector<HTMLInputElement>('input[type="range"]')!
  const number = document.querySelector<HTMLInputElement>('input[type="number"]')!
  slider.value = '1.8'
  slider.dispatchEvent(new Event('input'))
  expect(door.width).toBe(1.8)
  expect(number.value).toBe('1.8')
  slider.dispatchEvent(new Event('change'))
  stack.undo()
  expect(number.value).toBe('0.9')
  stack.redo()
  expect(slider.value).toBe('1.8')
  number.value = '1.23'
  number.dispatchEvent(new Event('change'))
  expect(door.width).toBe(1.23)
  slider.value = '2'
  slider.dispatchEvent(new Event('input'))
  slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(door.width).toBe(1.23)
  number.value = ''
  number.dispatchEvent(new Event('change'))
  expect(door.width).toBe(1.23)
  control.dispose()
})
