// @vitest-environment jsdom
import { expect, vi } from 'vitest'
import { scenario } from './gherkin'
import { ChatPanel } from '../../src/ui/panels/ChatPanel'
import type { DesignerEvents } from '../../src/app/designer/DesignerClient'
import type { DesignerScore } from '../../src/app/designer/actions'
import { sceneFromState } from '../../src/app/designer/scene'

const connection = vi.hoisted(() => ({ events: null as DesignerEvents | null, judgePreview: vi.fn() }))
vi.mock('../../src/app/designer/DesignerClient', () => ({ DesignerClient: class {
  connected = true
  endpoint = 'intermediate'
  constructor(events: DesignerEvents) { connection.events = events }
  chat() { return 'design' }
  stop() {}
  edit() {}
  judgePreview = connection.judgePreview
} }))
const score = (mean: number, revision: string, step: number): DesignerScore => ({
  cohesion: mean, colors: mean, style: mean, adherence: mean, rotation: mean, completeness: mean,
  overall: mean, mean, target: 7, round: 0, revision, at: `2026-09-16T10:0${step}:00Z`,
  preview: true, step, notes: 'Gira las sillas hacia la mesa.',
})

scenario('The conversation shows the real score evolution while furnishing', async () => {
  vi.useFakeTimers()
  try {
    sessionStorage.clear()
    document.body.innerHTML = '<aside id="chat"><span id="chat-status"></span><div id="chat-scores"></div><div id="chat-messages"></div><form id="chat-form"><textarea id="chat-input"></textarea></form></aside>'
    const state = { version: 1 as const, revision: 'saved', room: { shape: 'rect' as const, w: 5, d: 4, h: 2.6 }, openings: [], items: [] }
    const screenshot = 'data:image/png;base64,' + 'A'.repeat(200)
    new ChatPanel(document, { apply: () => ({ applied: 0, skipped: [] }), screenshot: () => screenshot,
      sceneIsEmpty: () => true, snapshot: () => sceneFromState(state), reconcile: () => {} })
    const events = connection.events!
    events.onConnection(true)
    events.onState(state)
    document.querySelector<HTMLTextAreaElement>('#chat-input')!.value = 'salón'
    document.querySelector('#chat-form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await Promise.resolve()
    const messages = document.querySelector<HTMLElement>('#chat-messages')!
    Object.defineProperties(messages, { scrollHeight: { value: 1500 }, clientHeight: { value: 200 } })
    messages.scrollTop = 300
    messages.dispatchEvent(new Event('scroll'))
    const activity = document.querySelector('#chat-thinking')!
    events.onActivity!({ requestId: 'design', runId: 'run', round: 0,
      entry: { kind: 'thinking', agent: 'Diseñador', text: 'Estoy amueblando.' } })
    for (const [step, mean] of [[1, 5], [2, 7]] as const) {
      const revision = `preview-${step}`
      events.onProgress!({ requestId: 'design', runId: 'run', state, evaluation: { runId: 'run', revision } })
      await vi.advanceTimersByTimeAsync(100)
      expect(connection.judgePreview).toHaveBeenLastCalledWith(screenshot, { runId: 'run', revision })
      events.onPreviewJudgement!({ runId: 'run', revision, verdict: score(mean, revision, step) })
      expect(document.querySelector('.score-mean')!.textContent).toContain(`${mean}/10`)
    }
    expect(document.querySelector('#chat-scores')!.textContent).toContain('Evolución de las notas')
    expect(document.querySelector('#chat-scores')!.textContent).toContain('Avance 1')
    expect(document.querySelector('#chat-scores')!.textContent).toContain('Avance 2')
    expect(document.querySelectorAll('.verdict-chip')).toHaveLength(12)
    expect(document.querySelector('#chat-thinking')).toBe(activity)
    expect(activity.textContent).toContain('Estoy amueblando.')
    expect(messages.scrollTop).toBe(300)
    events.onPreviewJudgement!({ runId: 'old', revision: 'old', verdict: score(1, 'old', 0) })
    expect(document.querySelector('.score-mean')!.textContent).toContain('7/10')
    events.onStopped!('run', 'Interrumpido')
    expect(document.querySelector('.score-mean')!.textContent).toBe('Pendiente de evaluación')
  } finally { vi.useRealTimers() }
})
