// @vitest-environment jsdom
import { expect, vi } from 'vitest'
import { scenario } from './gherkin'
import { ChatPanel } from '../../src/ui/panels/ChatPanel'
import type { DesignerEvents } from '../../src/app/designer/DesignerClient'
import { sceneFromState } from '../../src/app/designer/scene'

const mock = vi.hoisted(() => ({ events: null as DesignerEvents | null, chat: vi.fn() }))
vi.mock('../../src/app/designer/DesignerClient', () => ({ DesignerClient: class {
  connected = true
  endpoint = 'zoning'
  constructor(events: DesignerEvents) { mock.events = events }
  chat = mock.chat
  edit = vi.fn()
  stop = vi.fn()
} }))

scenario('The frontend displays the saved functional zones', async () => {
  sessionStorage.clear()
  document.body.innerHTML = '<aside id="chat"><div id="chat-status"></div><div id="chat-messages"></div><form id="chat-form"><textarea id="chat-input"></textarea></form></aside>'
  const state = { version: 1 as const, revision: 'zones', room: { shape: 'rect' as const, w: 5, d: 4, h: 2.6 },
    items: [], openings: [], zones: [
      { id: 'study', name: 'Estudio', x: 0, z: 0, w: 2, d: 4 },
      { id: 'sleep', name: 'Descanso', x: 2, z: 0, w: 3, d: 4 },
    ] }
  const showZones = vi.fn()
  new ChatPanel(document, { apply: () => ({ applied: 0, skipped: [] }), screenshot: () => '',
    sceneIsEmpty: () => true, snapshot: () => sceneFromState(state), reconcile() {}, showZones })
  mock.events!.onConnection(true)
  mock.events!.onState(state)
  expect(showZones).toHaveBeenLastCalledWith(state.zones)
  expect(document.querySelector('#chat-zones button')).toBeNull()
  expect(document.querySelector('#chat-zones svg')).toBeNull()
  expect(document.querySelector('#chat-zones')!.textContent).toContain('Estudio')
  mock.events!.onState({ ...state, revision: 'reset', zones: [] })
  expect(document.querySelector<HTMLElement>('#chat-zones')!.hidden).toBe(true)
})
