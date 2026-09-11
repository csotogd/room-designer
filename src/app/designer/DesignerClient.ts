import type { DesignerAction, DesignerRoomState, DesignerVerdict } from './actions'

export interface DesignerReply {
  requestId: string
  reply: string
  actions: DesignerAction[]
  state: DesignerRoomState
  rejected: { reason: string }[]
}

export interface DesignerEvents {
  onState(state: DesignerRoomState): void
  onReply(reply: DesignerReply): void
  onVerdict(requestId: string, verdict: DesignerVerdict): void
  onError(error: string): void
  onConnection(connected: boolean): void
}

/**
 * Cliente WebSocket del microservicio de diseño. Reconecta con backoff
 * simple; si el servicio no está, el panel lo dice — la app sigue viva.
 */
export class DesignerClient {
  private socket: WebSocket | null = null
  private retryMs = 1000
  private closed = false
  private counter = 0

  constructor(
    private readonly events: DesignerEvents,
    private readonly url: string = (import.meta.env?.VITE_DESIGNER_URL as string | undefined) ??
      'ws://localhost:8790/ws',
  ) {
    this.connect()
  }

  private connect(): void {
    if (this.closed) return
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.addEventListener('open', () => {
      this.events.onConnection(true)
    })
    socket.addEventListener('close', () => {
      this.events.onConnection(false)
      if (!this.closed) {
        setTimeout(() => this.connect(), this.retryMs)
        this.retryMs = Math.min(this.retryMs * 2, 15000)
      }
    })
    socket.addEventListener('message', (event) => {
      // El backoff se resetea al recibir datos reales, no en 'open': un
      // servidor que acepta y cierra al instante (token requerido) no debe
      // convertir la reconexión en un martilleo cada segundo.
      this.retryMs = 1000
      let message: Record<string, unknown>
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>
      } catch {
        return
      }
      if (message.type === 'state') this.events.onState(message.state as DesignerRoomState)
      else if (message.type === 'reply') this.events.onReply(message as unknown as DesignerReply)
      else if (message.type === 'judge.result') {
        this.events.onVerdict(String(message.requestId), message.verdict as DesignerVerdict)
      } else if (message.type === 'error') this.events.onError(String(message.error))
    })
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  chat(text: string): string {
    return this.send({ type: 'chat', text })
  }

  judge(brief: string, imageDataUrl: string): string {
    return this.send({ type: 'judge', brief, image: imageDataUrl })
  }

  private send(payload: Record<string, unknown>): string {
    const requestId = `ui-${Date.now().toString(36)}-${(this.counter++).toString(36)}`
    if (!this.connected) {
      this.events.onError('El servicio de diseño no está conectado.')
      return requestId
    }
    this.socket!.send(JSON.stringify({ ...payload, requestId }))
    return requestId
  }

  close(): void {
    this.closed = true
    this.socket?.close()
  }
}
