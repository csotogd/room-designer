import { expect, test, vi } from 'vitest'
import { WallEditTool } from '../../src/ui/view2d/tools/WallEditTool'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Point2D } from '../../src/core/geometry/Point2D'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import type { Selection, ToolContext } from '../../src/ui/types'

test('a pointer gesture selects and drags a connected wall, with one undo', () => {
  const project = new Project(FloorPlan.rectangle(5, 4))
  const stack = new CommandStack()
  let selection: Selection | null = null
  const ctx: ToolContext = { project, stack, catalog: new DefaultCatalog(),
    selection: () => selection, select: value => { selection = value }, hint: vi.fn() }
  const committed = vi.fn()
  const tool = new WallEditTool(ctx, committed)
  tool.onDown(new Point2D(5, 2))
  expect(ctx.selection()).toEqual({ kind: 'wall', wall: project.floorPlan.walls[1] })
  tool.onMove(new Point2D(6, 2))
  tool.onMove(new Point2D(7, 2))
  tool.onUp()
  expect(project.floorPlan.floorPolygon()!.area()).toBe(28)
  expect(committed).toHaveBeenCalledOnce()
  stack.undo()
  expect(project.floorPlan.floorPolygon()!.area()).toBe(20)
  expect(stack.canUndo()).toBe(false)
  tool.onDown(new Point2D(5, 0))
  tool.onMove(new Point2D(6, 0))
  tool.cancel()
  expect(project.floorPlan.walls[0]!.length()).toBe(5)
  tool.onDown(new Point2D(20, 20))
  expect(ctx.selection()).toBeNull()
})
