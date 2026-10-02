// @vitest-environment jsdom
import { expect, vi } from 'vitest'
import { scenario } from './gherkin'
import { ChatPanel } from '../../src/ui/panels/ChatPanel'
import type { DesignerEvents } from '../../src/app/designer/DesignerClient'
import { sceneFromState } from '../../src/app/designer/scene'

const connection = vi.hoisted(() => ({ events: null as DesignerEvents | null }))
vi.mock('../../src/app/designer/DesignerClient', () => ({ DesignerClient: class {
  connected = true
  endpoint = 'reading'
  constructor(events: DesignerEvents) { connection.events = events }
  chat() { return 'reading' }
  stop() {}
  edit() {}
} }))

scenario('New agent messages preserve the readers position', async () => {
  sessionStorage.clear()
  document.body.innerHTML = '<aside id="chat"><span id="chat-status"></span><div id="chat-messages"></div><form id="chat-form"><textarea id="chat-input"></textarea></form></aside>'
  const state = { version: 1 as const, revision: 'saved', room: null, openings: [], items: [] }
  new ChatPanel(document, { apply: () => ({ applied: 0, skipped: [] }), screenshot: () => '',
    sceneIsEmpty: () => true, snapshot: () => sceneFromState(state), reconcile: () => {} })
  const events = connection.events!
  events.onConnection(true)
  events.onState(state)
  document.querySelector<HTMLTextAreaElement>('#chat-input')!.value = 'salón'
  document.querySelector('#chat-form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await Promise.resolve()
  const messages = document.querySelector<HTMLElement>('#chat-messages')!
  let height = 1000
  Object.defineProperties(messages, { scrollHeight: { get: () => height }, clientHeight: { value: 200 } })
  messages.scrollTop = 300
  messages.dispatchEvent(new Event('scroll'))
  height = 1100
  events.onActivity!({ requestId: 'reading', runId: 'r', round: 0,
    entry: { kind: 'thinking', agent: 'Diseñador', text: 'Nueva decisión' } })
  expect(messages.scrollTop).toBe(300)
  events.onReply({ requestId: 'reading', runId: 'r', reply: 'Propuesta lista',
    actions: [], rejected: [], evaluation: null, state })
  expect(messages.scrollTop).toBe(300)
  messages.scrollTop = 900
  messages.dispatchEvent(new Event('scroll'))
  height = 1200
  events.onError('Nueva información')
  expect(messages.scrollTop).toBe(1200)
})
