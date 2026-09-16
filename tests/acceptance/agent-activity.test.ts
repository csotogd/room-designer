// @vitest-environment jsdom
import { afterEach, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { scenario } from './gherkin'
import { ChatPanel } from '../../src/ui/panels/ChatPanel'
import type { DesignerEvents } from '../../src/app/designer/DesignerClient'
import type { DesignerActivity, DesignerRoomState } from '../../src/app/designer/actions'
import { sceneFromState } from '../../src/app/designer/scene'

const mock = vi.hoisted(() => ({ events: null as DesignerEvents | null, chat: vi.fn(), stop: vi.fn() }))
vi.mock('../../src/app/designer/DesignerClient', () => ({ DesignerClient: class {
  connected = true
  endpoint = 'activity-test'
  constructor(events: DesignerEvents) { mock.events = events }
  chat = mock.chat
  stop = mock.stop
} }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
const state: DesignerRoomState = { version: 1, revision: 'v1', room: null, openings: [], items: [] }
const entry = { kind: 'thinking', agent: 'Diseñador', text: 'Compruebo el espacio libre.' } satisfies DesignerActivity

function openChat() {
  vi.useFakeTimers()
  sessionStorage.clear()
  mock.chat.mockReturnValue('c1')
  document.body.innerHTML = readFileSync('index.html', 'utf8')
  new ChatPanel(document, { apply: () => ({ applied: 0, skipped: [] }), screenshot: () => '',
    sceneIsEmpty: () => true, snapshot: () => sceneFromState(state), reconcile: () => {} })
  mock.events!.onConnection(true)
  mock.events!.onState(state)
}
async function send() {
  document.querySelector<HTMLTextAreaElement>('#chat-input')!.value = 'Ayúdame a diseñar'
  document.querySelector<HTMLFormElement>('#chat-form')!.requestSubmit()
  await Promise.resolve()
}
function progress(requestId = 'c1', runId = 'run1') {
  mock.events!.onActivity!({ requestId, runId, round: 0, entry })
}

scenario('Agent activity can be expanded and remains available after the reply', async () => {
  openChat()
  await send()
  const details = document.querySelector<HTMLDetailsElement>('.agent-activity details')!
  expect(details).not.toBeNull()
  expect(details.open).toBe(false)
  expect(document.querySelector('#chat-thinking')!.textContent).toContain('Pensando…')
  expect(details.querySelector('summary')!.textContent).toBe('Pensando…')
  details.open = true
  progress()
  expect(details.textContent).toContain(entry.text)
  expect(details.open).toBe(true)
  mock.events!.onReply({ requestId: 'c1', runId: 'run1', round: 0, evaluation: null, reply: 'Dime las medidas.',
    actions: [], rejected: [], state, activity: [entry] })
  expect(document.querySelector('#chat-thinking')).toBeNull()
  expect(details.textContent!.split(entry.text).length - 1).toBe(1)
  expect(details.open).toBe(true)
  mock.events!.onState({ ...state, conversation: [{ role: 'model', text: 'Dime las medidas.', activity: [entry] }] })
  expect(document.querySelector('.agent-activity')!.textContent).toContain(entry.text)
})

scenario('Stopped and superseded turns cannot update the active thinking panel', async () => {
  openChat()
  await send()
  progress()
  document.querySelector<HTMLButtonElement>('#chat-stop')!.click()
  expect(document.querySelector('#chat-thinking')).toBeNull()
  expect(document.querySelector('.agent-activity')!.textContent).toContain('Interrumpido')
  progress()
  expect(document.querySelector('#chat-thinking')).toBeNull()
  mock.chat.mockReturnValue('c2')
  await send()
  progress()
  const current = document.querySelector('#chat-thinking')!
  expect(current.textContent).not.toContain(entry.text)
  progress('c2', 'run2')
  expect(current.textContent).toContain(entry.text)
})

scenario('The judge displays every rubric grade out of ten', async () => {
  openChat()
  await send()
  const designed = { ...state, room: { shape: 'rect' as const, w: 5, d: 4, h: 2.6 } }
  mock.events!.onReply({ requestId: 'c1', runId: 'run1', evaluation: { runId: 'run1', revision: 'v1' },
    reply: 'Listo.', actions: [], rejected: [], state: designed })
  mock.events!.onJudgement({ requestId: 'j1', runId: 'run1', revision: 'v1', round: 0, state: designed,
    verdict: { cohesion: 8, colors: 6, style: 9, adherence: 7, rotation: 6, completeness: 9, overall: 8, notes: 'Ajusta los colores.' },
    mean: 7.5, target: 7, judgeText: 'Ajusta los colores.', feedback: null, refining: false, stopReason: 'objetivo alcanzado' })
  const verdict = document.querySelector('.chat-bubble.judge')!
  expect(verdict.textContent).toContain('7.5/10 (objetivo 7)')
  for (const label of ['Cohesión 8/10', 'Colores 6/10', 'Estilo 9/10', 'Adecuación al encargo 7/10', 'Rotación correcta 6/10', 'Completitud 9/10']) {
    expect(verdict.textContent).toContain(label)
  }
})
