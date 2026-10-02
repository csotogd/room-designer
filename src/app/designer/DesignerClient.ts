import type { DesignerActivity, DesignerActivityProgress, DesignerAction, DesignerJudgement, DesignerRoomState, EditResult, ManualEdit, EvaluationTicket } from './actions'

export interface DesignerReply {
  requestId: string
  runId: string
  evaluation: EvaluationTicket | null
  reply: string
  actions: DesignerAction[]
  activity?: DesignerActivity[]
  state: DesignerRoomState
  rejected: { reason: string }[]
  /** Encargo del usuario contra el que debe juzgarse la escena resultante. */
  judgeBrief?: string
  /** true: es un turno del bucle juez→agente, no una respuesta al usuario. */
  refinement?: boolean
  round?: number
}

export interface DesignerProgress {
  requestId: string
  runId: string
  state: DesignerRoomState
  evaluation?: EvaluationTicket
}

export interface DesignerPreviewJudgement {
  runId: string
  revision: string
  verdict: import('./actions').DesignerScore
}

export interface DesignerEvents {
  onPreviewJudgement?(judgement: DesignerPreviewJudgement): void
  onProgress?(progress: DesignerProgress): void
  onActivity?(progress: DesignerActivityProgress): void
  onState(state: DesignerRoomState): void
  onReply(reply: DesignerReply): void
  onJudgement(judgement: DesignerJudgement): void
  onStopped?(runId: string, reason: string): void
  onEdit?(result: EditResult): void
  onError(error: string, context?: { runId?: string; requestId?: string; state?: DesignerRoomState }): void
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
  private readonly localPage: string | null

  constructor(
    private readonly events: DesignerEvents,
    private readonly url: string = (import.meta.env?.VITE_DESIGNER_URL as string | undefined) ??
      'ws://localhost:8790/ws',
    freshLocalPage = false,
  ) {
    this.localPage = freshLocalPage ? crypto.randomUUID() : null
    this.connect()
  }

  private connect(): void {
    if (this.closed) return
    const url = new URL(this.url)
    if (this.localPage) url.searchParams.set('localPage', this.localPage)
    const socket = new WebSocket(url.toString())
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
      else if (message.type === 'design.progress') this.events.onProgress?.(message as unknown as DesignerProgress)
      else if (message.type === 'agent.progress') this.events.onActivity?.(message as unknown as DesignerActivityProgress)
      else if (message.type === 'reply') this.events.onReply(message as unknown as DesignerReply)
      else if (message.type === 'edit.result' || message.type === 'edit.conflict') this.events.onEdit?.(message as unknown as EditResult)
      else if (message.type === 'judge.preview.result') this.events.onPreviewJudgement?.(message as unknown as DesignerPreviewJudgement)
      else if (message.type === 'judge.result') {
        this.events.onJudgement(message as unknown as DesignerJudgement)
      } else if (message.type === 'loop.stopped') {
        this.events.onStopped?.(String(message.runId), String(message.reason))
      } else if (message.type === 'error') this.events.onError(String(message.error), {
        runId: typeof message.runId === 'string' ? message.runId : undefined,
        requestId: typeof message.requestId === 'string' ? message.requestId : undefined,
        state: message.state as DesignerRoomState | undefined,
      })
    })
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  chat(text: string, revision?: string): string {
    return this.send({ type: 'chat', text, revision, progress: true, activity: true,
      liveEvaluation: !!this.events.onProgress && !!this.events.onPreviewJudgement })
  }

  get endpoint(): string { return this.url }

  edit(edit: ManualEdit): void {
    this.send({ type: 'edit', ...edit }, edit.requestId)
  }

  judge(imageDataUrl: string, ticket: EvaluationTicket): string {
    return this.send({ type: 'judge', image: imageDataUrl, ...ticket })
  }

  judgePreview(imageDataUrl: string, ticket: EvaluationTicket): string {
    return this.send({ type: 'judge.preview', image: imageDataUrl, ...ticket })
  }

  stop(runId?: string): void {
    this.send({ type: 'stop', runId })
  }

  private send(payload: Record<string, unknown>, id?: string): string {
    const requestId = id ?? `ui-${Date.now().toString(36)}-${(this.counter++).toString(36)}`
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
