// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { DesignerEvents, DesignerReply } from '../../src/app/designer/DesignerClient'
import type { DesignerJudgement, DesignerRoomState, DesignerScore, ManualEdit } from '../../src/app/designer/actions'
import { sceneFromState } from '../../src/app/designer/scene'
import { applyDesignerActions } from '../../src/app/designer/actionApplier'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { CommandStack } from '../../src/app/commands/CommandStack'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Project } from '../../src/core/model/Project'
import { ChatPanel, type ChatPanelHost } from '../../src/ui/panels/ChatPanel'

const mock = vi.hoisted(() => ({ connected: true, events: null as DesignerEvents | null, chat: vi.fn(), judge: vi.fn(), stop: vi.fn(), edit: vi.fn() }))
vi.mock('../../src/app/designer/DesignerClient', () => ({ DesignerClient: class {
  get connected() { return mock.connected }
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
  document.querySelector<HTMLTextAreaElement>('#chat-input')!.value = 'oficina moderna'
  document.querySelector('#chat-form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mock.connected = true
  sessionStorage.clear()
  mock.chat.mockReturnValue('c1')
  document.body.innerHTML = '<div id="prompt-dock"></div><aside id="chat"><span id="chat-status"></span><div id="chat-scores" hidden></div><div id="chat-messages"></div><div id="chat-composer-slot"><div class="chat-composer"><form id="chat-form"><textarea id="chat-input"></textarea></form></div></div><button id="chat-stop" hidden>Detener</button><button id="chat-toggle">Cerrar</button></aside><button id="chat-reopen">Asistente</button>'
  host = { apply: vi.fn(() => ({ applied: 1, skipped: [] })), screenshot: vi.fn(() => image), sceneIsEmpty: () => true, snapshot: () => sceneFromState(state()), reconcile: vi.fn() }
  panel = new ChatPanel(document, host)
  events().onConnection(true)
  events().onState(state())
})
afterEach(() => { vi.useRealTimers() })

describe('ChatPanel judge-agent handoff', () => {
  test('aplica varios movimientos, un giro y una sustitución antes de capturar la ronda', async () => {
    await submit()
    events().onReply(reply())
    await vi.advanceTimersByTimeAsync(100)
    events().onJudgement(judgement())

    const catalog = new DefaultCatalog()
    const [chair, replacement] = catalog.items()
    const project = new Project(FloorPlan.rectangle(5, 4, 2.6))
    const stack = new CommandStack()
    const context = { project: () => project, catalog, stack, replaceRoom: vi.fn() }
    applyDesignerActions(context, ['a', 'b', 'c', 'd'].map((uid, i) => ({
      kind: 'placeNew', uid, productId: chair!.id, x: i + .5, z: 1, rotDeg: 0, query: '',
    })))
    const batch: DesignerReply = { ...reply(1, 'v2'), actions: [
      { kind: 'move', uid: 'a', x: .5, z: 2 },
      { kind: 'move', uid: 'b', x: 1.5, z: 2 },
      { kind: 'rotate', uid: 'c', rotDeg: 90 },
      { kind: 'replace', uid: 'd', productId: replacement!.id, x: 3.5, z: 1, rotDeg: 0, query: '' },
    ] }
    host.apply.mockImplementation((actions) => applyDesignerActions(context, actions))
    host.screenshot.mockImplementation(() => {
      const furniture = Object.fromEntries(project.furniture.map((item) => [item.id, item]))
      expect(furniture.a!.position.z).toBe(2)
      expect(furniture.b!.position.z).toBe(2)
      expect(furniture.c!.rotationY).toBeCloseTo(Math.PI / 2)
      expect(furniture.d!.item.id).toBe(replacement!.id)
      return image
    })
    host.screenshot.mockClear()

    events().onReply(batch)
    expect(host.apply).toHaveBeenLastCalledWith(batch.actions)
    expect(host.screenshot).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(host.screenshot).toHaveBeenCalledOnce()
    expect(mock.judge).toHaveBeenLastCalledWith(image, batch.evaluation)
    stack.undo()
    expect(project.furniture.every((item) => item.position.z === 1 && item.rotationY === 0 && item.item.id === chair!.id)).toBe(true)
  })

  test('renders a conversational response without starting capture or judging', async () => {
    await submit()
    events().onReply({ ...reply(), evaluation: null, reply: '¿Qué ambiente buscas?' })
    await vi.advanceTimersByTimeAsync(100)
    expect(text()).toContain('¿Qué ambiente buscas?')
    expect(host.screenshot).not.toHaveBeenCalled()
    expect(mock.judge).not.toHaveBeenCalled()
    expect(stopButton().hidden).toBe(true)
  })
  test('opens the conversation on submit and keeps the idea if the service is offline', async () => {
    mock.connected = false
    await submit()
    expect(document.querySelector<HTMLElement>('#chat')!.inert).toBe(false)
    expect(document.querySelector<HTMLTextAreaElement>('#chat-input')!.value).toBe('oficina moderna')
    expect(text()).toContain('El servicio de diseño no está conectado.')
    expect(mock.chat).not.toHaveBeenCalled()
  })

  test('sends with Enter but not with an empty idea, Shift+Enter or IME composition', async () => {
    const input = document.querySelector<HTMLTextAreaElement>('#chat-input')!
    const enter = (options = {}) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options }))
    input.value = '  '
    enter()
    expect(document.querySelector<HTMLElement>('#chat')!.inert).toBe(true)
    input.value = 'Un salón tranquilo'
    expect(enter({ shiftKey: true })).toBe(true)
    expect(enter({ isComposing: true })).toBe(true)
    expect(mock.chat).not.toHaveBeenCalled()
    expect(enter()).toBe(false)
    await Promise.resolve()
    expect(mock.chat).toHaveBeenCalledExactlyOnceWith('Un salón tranquilo', 'v1')
  })

  test('starts in the floating composer and moves the same draft when opening or closing', () => {
    const input = document.querySelector<HTMLTextAreaElement>('#chat-input')!
    expect(document.querySelector<HTMLElement>('#chat')!.inert).toBe(true)
    expect(document.querySelector('#prompt-dock')!.contains(input)).toBe(true)
    input.value = 'Un salón tranquilo'
    panel.setOpen(true)
    expect(document.querySelector('#chat')!.contains(input)).toBe(true)
    panel.setOpen(false)
    expect(input.value).toBe('Un salón tranquilo')
    expect(document.querySelector('#prompt-dock')!.contains(input)).toBe(true)
  })

  test('waits for the manual save before sending the prompt with its confirmed revision', async () => {
    const local = sceneFromState(state())
    local.environment.timeOfDay = 18
    host.snapshot = () => local
    panel.onSceneChanged()
    await submit()
    expect(mock.chat).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLTextAreaElement>('#chat-input')!.value).toBe('oficina moderna')
    const edit = mock.edit.mock.calls[0]![0] as ManualEdit
    events().onEdit!({ type: 'edit.result', requestId: edit.requestId,
      state: { ...state('saved-manual'), ...edit.desired } })
    await Promise.resolve()
    expect(mock.chat).toHaveBeenCalledExactlyOnceWith('oficina moderna', 'saved-manual')
    expect(document.querySelector<HTMLTextAreaElement>('#chat-input')!.value).toBe('')
  })

  test.each([true, false])('offers an explicit conflict choice and preserves the unsent prompt: keep local=%s', async (keep) => {
    panel.setOpen(false)
    let local = sceneFromState(state())
    local.environment.timeOfDay = 18
    host.snapshot = () => local
    host.reconcile = (value) => { local = structuredClone(value) }
    panel.onSceneChanged()
    await submit()
    const edit = mock.edit.mock.calls[0]![0] as ManualEdit
    const remote = sceneFromState(state())
    remote.environment.timeOfDay = 20
    events().onEdit!({ type: 'edit.conflict', requestId: edit.requestId,
      state: { ...state('other-tab'), ...remote }, conflicts: ['hora'] })
    await Promise.resolve()
    const choices = [...document.querySelectorAll<HTMLButtonElement>('#chat-sync button')]
    expect(document.querySelector('#chat')!.classList.contains('collapsed')).toBe(false)
    expect(choices.every((button) => !button.hidden)).toBe(true)
    expect(mock.chat).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLTextAreaElement>('#chat-input')!.value).toBe('oficina moderna')
    choices[keep ? 0 : 1]!.click()
    expect(local.environment.timeOfDay).toBe(keep ? 18 : 20)
    expect(choices.every((button) => button.hidden)).toBe(true)
    expect(mock.edit).toHaveBeenCalledTimes(keep ? 2 : 1)
  })

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
