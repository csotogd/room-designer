import { afterEach, expect, test, vi } from 'vitest'
import { DesignerClient } from '../../src/app/designer/DesignerClient'

class Socket extends EventTarget {
  static OPEN = 1
  static current: Socket
  readyState = 1
  send = vi.fn()
  close = vi.fn()
  constructor() { super(); Socket.current = this }
}
afterEach(() => vi.unstubAllGlobals())

test('solicita progreso y entrega la actividad recibida sin mezclarla con la respuesta', () => {
  vi.stubGlobal('WebSocket', Socket)
  const progress = vi.fn()
  const reply = vi.fn()
  const client = new DesignerClient({ onActivity: progress, onReply: reply, onState: vi.fn(),
    onJudgement: vi.fn(), onError: vi.fn(), onConnection: vi.fn() }, 'ws://local/ws')
  const requestId = client.chat('hola')
  expect(JSON.parse(Socket.current.send.mock.calls[0]![0])).toMatchObject({ activity: true, requestId })
  const event = { type: 'agent.progress', requestId, runId: 'r', round: 0,
    entry: { kind: 'thinking', agent: 'Diseñador', text: 'Compruebo las medidas.' } }
  Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }))
  expect(progress).toHaveBeenCalledExactlyOnceWith(event)
  expect(reply).not.toHaveBeenCalled()
  client.close()
})

test('solicita la escena provisional y la entrega sin confirmar el turno', () => {
  vi.stubGlobal('WebSocket', Socket)
  const progress = vi.fn()
  const reply = vi.fn()
  const client = new DesignerClient({ onProgress: progress, onReply: reply, onState: vi.fn(),
    onJudgement: vi.fn(), onError: vi.fn(), onConnection: vi.fn() }, 'ws://local/ws')
  const requestId = client.chat('coloca una silla')
  expect(JSON.parse(Socket.current.send.mock.calls[0]![0])).toMatchObject({ progress: true, requestId })
  const event = { type: 'design.progress', requestId, runId: 'r', state: { items: [] } }
  Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }))
  expect(progress).toHaveBeenCalledExactlyOnceWith(event)
  expect(reply).not.toHaveBeenCalled()
  client.close()
})

test('identifica una carga local nueva y conserva su identificador al reconectar', () => {
  vi.useFakeTimers()
  const urls: string[] = []
  class LocalSocket extends Socket {
    constructor(url: string) { super(); urls.push(url) }
  }
  vi.stubGlobal('WebSocket', LocalSocket)
  const client = new DesignerClient({ onReply: vi.fn(), onState: vi.fn(), onJudgement: vi.fn(),
    onError: vi.fn(), onConnection: vi.fn() }, 'ws://localhost:8790/ws?token=test', true)
  expect(new URL(urls[0]!).searchParams.get('localPage')).toBeTruthy()
  expect(new URL(urls[0]!).searchParams.get('token')).toBe('test')
  Socket.current.dispatchEvent(new Event('close'))
  vi.advanceTimersByTime(1000)
  expect(urls[1]).toBe(urls[0])
  client.close()
  vi.useRealTimers()
})

test('solicita evaluaciones intermedias y envía la captura vinculada al avance', () => {
  vi.stubGlobal('WebSocket', Socket)
  const review = vi.fn()
  const client = new DesignerClient({ onPreviewJudgement: review, onProgress: vi.fn(), onReply: vi.fn(), onState: vi.fn(),
    onJudgement: vi.fn(), onError: vi.fn(), onConnection: vi.fn() }, 'ws://local/ws')
  client.chat('salón')
  expect(JSON.parse(Socket.current.send.mock.calls[0]![0])).toMatchObject({ liveEvaluation: true })
  client.judgePreview('data:image/png;base64,test', { runId: 'r', revision: 'p' })
  expect(JSON.parse(Socket.current.send.mock.calls[1]![0])).toMatchObject({
    type: 'judge.preview', runId: 'r', revision: 'p', image: 'data:image/png;base64,test',
  })
  const result = { type: 'judge.preview.result', runId: 'r', revision: 'p', verdict: { mean: 6 } }
  Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(result) }))
  expect(review).toHaveBeenCalledExactlyOnceWith(result)
  client.close()
})
