import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import {
  DEFAULT_FLOOR_FINISH,
  DEFAULT_WALL_FINISH,
} from '../../src/core/model/Finishes'
import { CommandStack } from '../../src/app/commands/CommandStack'
import {
  SetFloorFinishCommand,
  SetWallFinishCommand,
} from '../../src/app/commands/FinishCommands'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import {
  serializeProject,
  deserializeProject,
} from '../../src/app/serialization/ProjectSerializer'

const catalog = new DefaultCatalog()
const room = () => new Project(FloorPlan.rectangle(5, 4))

feature('Wall and floor finishes', () => {
  scenario('A project starts with sensible default finishes', () => {
    const p = room()
    expect(p.wallFinish).toEqual(DEFAULT_WALL_FINISH)
    expect(p.wallFinish.material).toBe('paint')
    expect(p.floorFinish).toEqual(DEFAULT_FLOOR_FINISH)
    expect(p.floorFinish.material).toBe('wood')
  })

  scenario('Changing the wall finish is undoable', () => {
    const p = room()
    const stack = new CommandStack()
    stack.execute(new SetWallFinishCommand(p, { material: 'stripes', color: '#b9c4b1' }))
    expect(p.wallFinish).toEqual({ material: 'stripes', color: '#b9c4b1' })
    stack.undo()
    expect(p.wallFinish).toEqual(DEFAULT_WALL_FINISH)
  })

  scenario('Changing the floor finish is undoable', () => {
    const p = room()
    const stack = new CommandStack()
    stack.execute(new SetFloorFinishCommand(p, { material: 'tiles', color: '#b9b4ab' }))
    expect(p.floorFinish).toEqual({ material: 'tiles', color: '#b9b4ab' })
    stack.undo()
    expect(p.floorFinish).toEqual(DEFAULT_FLOOR_FINISH)
  })

  scenario('Finishes survive the JSON round-trip', () => {
    const p = room()
    p.setWallFinish({ material: 'brick', color: '#d8a48f' })
    p.setFloorFinish({ material: 'carpet', color: '#c9ada7' })
    const doc = serializeProject(p)
    const restored = deserializeProject(JSON.parse(JSON.stringify(doc)), catalog)
    expect(restored.wallFinish).toEqual({ material: 'brick', color: '#d8a48f' })
    expect(restored.floorFinish).toEqual({ material: 'carpet', color: '#c9ada7' })
  })

  scenario('A version 1 document loads with default finishes', () => {
    const p = room()
    const v1 = { ...serializeProject(p), version: 1 } as Record<string, unknown>
    delete v1.finishes
    const restored = deserializeProject(
      JSON.parse(JSON.stringify(v1)),
      catalog,
    )
    expect(restored.wallFinish).toEqual(DEFAULT_WALL_FINISH)
    expect(restored.floorFinish).toEqual(DEFAULT_FLOOR_FINISH)
  })
})
