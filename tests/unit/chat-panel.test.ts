// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { DesignerEvents, DesignerReply } from '../../src/app/designer/DesignerClient'
import type { DesignerJudgement, DesignerRoomState, DesignerScore } from '../../src/app/designer/actions'
import { sceneFromState } from '../../src/app/designer/scene'
import { ChatPanel, type ChatPanelHost } from '../../src/ui/panels/ChatPanel'

const mock = vi.hoisted(() => ({ events: null as DesignerEvents | null, chat: vi.fn(), judge: vi.fn(), stop: vi.fn(), edit: vi.fn() }))
vi.mock('../../src/app/designer/DesignerClient', () => ({ DesignerClient: class {
  connected = true
  constructor(events: DesignerEvents) { mock.events = events }
  chat = mock.chat
  judge = mock.judge
  stop = mock.stop
  edit = mock.edit
  endpoint = "test"
} }))

const state = (revision = 'v1'): DesignerRoomState => ({ version: 1, revision,
  room: { shape: 'rect', w: 5, d: 4, h: 2.6 }, items: [], openings: [] })
const score = (mean = 6, revision = 'v1'): DesignerScore => ({ cohesion: mean, colors: mean, style: mean,
  adherence: mean, overall: 10, mean, notes: 'Equilibra los colores.', target: 7, round: 0,
  at: '2026-09-12T09:00:00Z', revision })
const reply = (round = 0, revision = 'v1'): DesignerReply => ({ requestId: round ? 'refine' : 'c1', runId: 'run1',
  evaluation: { runId: 'run1', revision }, reply: 'He revisado los muebles.', actions: [], state: state(revision),
  rejected: [], round, refinement: round > 0 })
const judgement = (mean = 6, revision = 'v1'): DesignerJudgement => ({ requestId: 'j1', runId: 'run1', revision,
  verdict: score(mean, revision), state: { ...state(revision), verdict: score(mean, revision), verdicts: [score(mean, revision)] },
  mean, target: 7, judgeText: 'Equilibra los colores.', feedback: mean < 7 ? 'Cambia la silla por una de tonos cálidos.' : null,
  refining: mean < 7, round: 0, stopReason: mean >= 7 ? 'objetivo alcanzado' : null })
const image = 'data:image/png;base64,' + 'A'.repeat(200)
let panel: ChatPanel
let host: { apply: Mock<ChatPanelHost['apply']>; screenshot: Mock<ChatPanelHost['screenshot']>; sceneIsEmpty: () => boolean; snapshot: ChatPanelHost["snapshot"]; reconcile: ChatPanelHost["reconcile"] }
const events = () => mock.events!
const text = () => document.body.textContent!
const stopButton = () => document.querySelector<HTMLButtonElement>('#chat-stop')!

async function submit() {
  document.querySelector<HTMLInputElement>('#chat-input')!.value = 'oficina moderna'
  document.querySelector('#chat-form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  sessionStorage.clear()
  mock.chat.mockReturnValue('c1')
  document.body.innerHTML = '<aside id="chat"><span id="chat-status"></span><div id="chat-scores" hidden></div><div id="chat-messages"></div><form id="chat-form"><input id="chat-input"></form><button id="chat-stop" hidden>Detener</button></aside>'
  host = { apply: vi.fn(() => ({ applied: 1, skipped: [] })), screenshot: vi.fn(() => image), sceneIsEmpty: () => true, snapshot: () => sceneFromState(state()), reconcile: vi.fn() }
  panel = new ChatPanel(document, host)
  events().onConnection(true)
  events().onState(state())
})
afterEach(() => { vi.useRealTimers() })

describe('ChatPanel judge-agent handoff', () => {
  test('shows both speakers and scores, evaluates even without actions, and finishes at target', async () => {
    await submit()
    events().onReply(reply())
    await vi.advanceTimersByTimeAsync(100)
    expect(mock.judge).toHaveBeenLastCalledWith(image, reply().evaluation)
    events().onJudgement(judgement())
    expect(text()).toContain('Juez · 6/10')
    expect(text()).toContain('Cambia la silla por una de tonos cálidos.')
    expect(stopButton().hidden).toBe(false)
    events().onReply(reply(1, 'v2'))
    expect(text()).toContain('Agente (ronda 1): He revisado los muebles.')
    expect(document.querySelector('#chat-scores')!.textContent).toContain('Pendiente de evaluación')
    await vi.advanceTimersByTimeAsync(100)
    expect(mock.judge).toHaveBeenCalledTimes(2)
    expect(mock.judge).toHaveBeenLastCalledWith(image, reply(1, 'v2').evaluation)
    events().onJudgement(judgement(7.5, 'v2'))
    expect(text()).toContain('objetivo alcanzado')
    expect(document.querySelector('#chat-scores')!.textContent).toContain('7.5/10')
    expect(stopButton().hidden).toBe(true)
    expect(document.querySelector('#chat-thinking')).toBeNull()
  })

  test('stop cancels a delayed capture and ignores late replies and verdicts', async () => {
    await submit()
    events().onReply(reply())
    stopButton().click()
    expect(mock.stop).toHaveBeenCalledWith('run1')
    events().onJudgement(judgement())
    events().onReply(reply(1, 'v2'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(mock.judge).not.toHaveBeenCalled()
    expect(text()).not.toContain('Juez ·')
    expect(stopButton().hidden).toBe(true)
  })

  test('a new prompt invalidates an async capture already in progress', async () => {
    let resolve!: (value: string) => void
    host.screenshot.mockReturnValue(new Promise<string>((done) => { resolve = done }))
    await submit()
    events().onReply(reply())
    await vi.advanceTimersByTimeAsync(100)
    await submit()
    events().onError('Error de un ciclo anterior', { runId: 'old-run', requestId: 'old-request' })
    resolve(image)
    await vi.advanceTimersByTimeAsync(1)
    expect(mock.judge).not.toHaveBeenCalled()
    expect(document.querySelectorAll('#chat-thinking')).toHaveLength(1)
    expect(text()).not.toContain('Error de un ciclo anterior')
  })

  test('manual edits stop the cycle and invalidate the displayed grade', async () => {
    await submit()
    events().onReply(reply())
    events().onJudgement(judgement())
    panel.onSceneChanged()
    expect(mock.stop).toHaveBeenCalledWith('run1')
    expect(document.querySelector('#chat-scores')!.textContent).toBe('Pendiente de evaluación')
    await vi.advanceTimersByTimeAsync(200)
    expect(mock.judge).not.toHaveBeenCalled()
  })

  test('failed scene application and failed screenshots never reach the judge', async () => {
    await submit()
    host.apply.mockReturnValue({ applied: 0, skipped: [{ reason: 'producto no encontrado' }] })
    events().onReply(reply())
    await vi.advanceTimersByTimeAsync(100)
    expect(mock.judge).not.toHaveBeenCalled()
    expect(text()).toContain('No pude aplicar 1 cambios')
    host.apply.mockReturnValue({ applied: 1, skipped: [] })
    host.screenshot.mockRejectedValue(new Error('modelo GLB no disponible'))
    await submit()
    events().onReply(reply())
    await vi.advanceTimersByTimeAsync(100)
    expect(text()).toContain('modelo GLB no disponible')
    expect(mock.judge).not.toHaveBeenCalled()
    expect(stopButton().hidden).toBe(true)
  })

  test('reconnection restores readable history and grades without restarting the cycle', () => {
    events().onConnection(false)
    events().onConnection(true)
    events().onState({ ...state(), verdict: score(), verdicts: [score(5), score(6)], conversation: [
      { role: 'user', text: 'oficina moderna' }, { role: 'judge', text: 'Falta armonía.' },
      { role: 'model', text: 'He cambiado la silla.', round: 1 },
    ] })
    expect(text()).toContain('Juez: Falta armonía.')
    expect(text()).toContain('Agente (ronda 1): He cambiado la silla.')
    expect(text()).toContain('Evolución de las notas')
    expect(mock.chat).not.toHaveBeenCalled()
    expect(mock.judge).not.toHaveBeenCalled()
    expect(stopButton().hidden).toBe(true)
    // A grade broadcast for the same revision must not reset geometry or undo.
    host.apply.mockClear()
    events().onState({ ...state(), verdict: score() })
    expect(host.apply).not.toHaveBeenCalled()
  })
})
