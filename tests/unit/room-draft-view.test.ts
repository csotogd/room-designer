// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { RoomDraftView } from '../../src/ui/panels/RoomDraftView'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Point2D } from '../../src/core/geometry/Point2D'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { mockCanvas } from '../helpers/canvas'

test('the selected wall panel precedes the starting templates', () => {
  document.body.innerHTML = readFileSync('index.html', 'utf8')
  const panel = document.querySelector('#wall-inspector')!
  const templates = document.querySelector('#shape-cards')!
  expect(panel.compareDocumentPosition(templates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('the draft view displays changes to the room being created', () => {
  document.body.innerHTML = readFileSync('index.html', 'utf8')
  mockCanvas()
  const project = new Project(FloorPlan.rectangle(5, 4))
  new RoomDraftView(document, project, new CommandStack())
  expect(document.querySelector('#room-area')!.textContent).toContain('20')
  project.reshapeWall(project.floorPlan.walls[1]!, new Point2D(6, 0), new Point2D(6, 4))
  expect(document.querySelector('#room-area')!.textContent).toContain('24')
})
