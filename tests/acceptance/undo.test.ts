import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { PlaceFurnitureCommand } from '../../src/app/commands/PlaceFurnitureCommand'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'

const catalog = new DefaultCatalog()
const room = () => new Project(FloorPlan.rectangle(5, 4))

feature('Undo and redo', () => {
  scenario('Undo removing a placed furniture item', () => {
    const p = room()
    const stack = new CommandStack()
    stack.execute(new PlaceFurnitureCommand(p, catalog.get('sofa'), 2, 1))
    stack.undo()
    expect(p.furniture).toHaveLength(0)
  })

  scenario('Redo restores the undone command', () => {
    const p = room()
    const stack = new CommandStack()
    stack.execute(new PlaceFurnitureCommand(p, catalog.get('sofa'), 2, 1))
    stack.undo()
    stack.redo()
    expect(p.furniture).toHaveLength(1)
  })

  scenario('A new command clears the redo history', () => {
    const p = room()
    const stack = new CommandStack()
    stack.execute(new PlaceFurnitureCommand(p, catalog.get('sofa'), 2, 1))
    stack.undo()
    stack.execute(new PlaceFurnitureCommand(p, catalog.get('table'), 3, 3))
    expect(stack.canRedo()).toBe(false)
  })
})
