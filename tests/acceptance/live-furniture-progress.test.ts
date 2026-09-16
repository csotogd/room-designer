// @vitest-environment jsdom
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { scenario } from './gherkin'
import { ChatPanel } from '../../src/ui/panels/ChatPanel'
import type { DesignerEvents } from '../../src/app/designer/DesignerClient'
import type { DesignerRoomState } from '../../src/app/designer/actions'
import { sceneFromState, snapshotProject, reconcileProject } from '../../src/app/designer/scene'
import { applyDesignerActions } from '../../src/app/designer/actionApplier'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { CommandStack } from '../../src/app/commands/CommandStack'

const connection = vi.hoisted(() => ({ events: null as DesignerEvents | null, judge: vi.fn() }))
vi.mock('../../src/app/designer/DesignerClient', () => ({ DesignerClient: class {
  connected = true
  endpoint = 'live-test'
  constructor(events: DesignerEvents) { connection.events = events }
  chat() { return 'live-request' }
  stop() {}
  edit() {}
  judge = connection.judge
} }))
const saved: DesignerRoomState = { version: 1, revision: 'saved',
  room: { shape: 'rect', w: 5, d: 4, h: 2.6 }, items: [], openings: [] }
const catalog = new DefaultCatalog()
const item = { uid: 'chair', productId: catalog.items()[0]!.id, x: 1, y: 0, z: 1, rotDeg: 0, query: '' }
let project: Project
let stack: CommandStack
let preview: DesignerRoomState
const events = () => connection.events!
const showProgress = (state = preview) => events().onProgress!({ requestId: 'live-request', runId: 'live', state })

beforeEach(async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  sessionStorage.clear()
  document.body.innerHTML = '<aside id="chat"><span id="chat-status"></span><div id="chat-messages"></div><form id="chat-form"><textarea id="chat-input"></textarea></form><button id="chat-stop"></button></aside>'
  project = new Project(FloorPlan.rectangle(5, 4, 2.6), 2.6)
  stack = new CommandStack()
  preview = { ...saved, items: [item] }
  new ChatPanel(document, {
    apply: actions => applyDesignerActions({ project: () => project, catalog, stack, replaceRoom: vi.fn() }, actions),
    screenshot: () => 'data:image/png;base64,' + 'A'.repeat(200),
    sceneIsEmpty: () => true,
    snapshot: () => snapshotProject(project),
    reconcile: scene => reconcileProject(project, scene, catalog),
  })
  events().onConnection(true)
  events().onState(saved)
  document.querySelector<HTMLTextAreaElement>('#chat-input')!.value = 'Salón moderno'
  document.querySelector('#chat-form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await Promise.resolve()
})
afterEach(() => vi.useRealTimers())

scenario('Furniture changes appear before the agent finishes its turn', async () => {
  showProgress()
  expect(project.furniture.map(f => f.id)).toEqual(['chair'])
  preview = { ...preview, items: [{ ...item, x: 2, rotDeg: 90 }] }
  showProgress()
  expect(project.furniture[0]!.position.x).toBe(2)
  expect(project.furniture[0]!.rotationY).toBeCloseTo(Math.PI / 2)
  events().onReply({ requestId: 'live-request', runId: 'live', reply: 'Listo', rejected: [],
    evaluation: { runId: 'live', revision: 'final' }, state: { ...preview, revision: 'final' },
    actions: [{ kind: 'placeNew', ...item }, { kind: 'move', uid: 'chair', x: 2, z: 1 },
      { kind: 'rotate', uid: 'chair', rotDeg: 90 }] })
  expect(document.body.textContent).not.toContain('No pude aplicar')
  expect(project.furniture).toHaveLength(1)
  expect(project.furniture[0]!.rotationY).toBeCloseTo(Math.PI / 2)
  await vi.advanceTimersByTimeAsync(100)
  expect(connection.judge).toHaveBeenCalledOnce()
  stack.undo()
  expect(project.furniture).toHaveLength(0)
})

scenario('Interrupted previews restore the saved room', () => {
  showProgress()
  expect(project.furniture).toHaveLength(1)
  events().onError('No se guardaron los cambios provisionales.', { runId: 'live', requestId: 'live-request' })
  expect(snapshotProject(project)).toEqual(sceneFromState(saved))
  showProgress()
  expect(project.furniture).toHaveLength(0)
  expect(document.body.textContent).toContain('No se guardaron los cambios provisionales.')
})
