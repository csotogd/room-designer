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
