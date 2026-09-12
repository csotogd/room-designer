import { DesignerClient, type DesignerReply } from '../../app/designer/DesignerClient'
import { stateToActions, type DesignerAction, type DesignerJudgement, type DesignerRoomState } from '../../app/designer/actions'

/**
 * Panel de chat del diseñador (columna derecha): le pides "créame una
 * oficina para 4, moderna" y aplica las acciones del microservicio a la
 * escena. Tras aplicar, captura un screenshot y se lo manda al juez VLM.
 *
 * El juez y el agente CONVERSAN aquí, a la vista: el veredicto aparece como
 * mensaje del juez en lenguaje natural, y si la nota media no llega al
 * objetivo el servidor relanza al agente (rondas de refinamiento) hasta
 * alcanzarlo o estancarse. La nota actual de la habitación vive en el
 * marcador de la cabecera.
 */
export interface ChatPanelHost {
  /** Aplica acciones al dominio; devuelve cuántas entraron y cuáles no. */
  apply(actions: readonly DesignerAction[]): { applied: number; skipped: { reason: string }[] }
  /** Screenshot PNG (dataURL) de la escena 3D actual. */
  screenshot(): string
  /** ¿Hay ya una escena con muebles? (para no restaurar encima). */
  sceneIsEmpty(): boolean
}

export class ChatPanel {
  private readonly client: DesignerClient
  private readonly messages: HTMLElement
  private readonly input: HTMLInputElement
  private readonly status: HTMLElement
  private readonly scores: HTMLElement | null
  /** Brief por requestId: el juez puntúa contra el brief de SU turno. */
  private readonly briefs = new Map<string, string>()
  private restored = false

  constructor(
    private readonly root: Document,
    private readonly host: ChatPanelHost,
  ) {
    this.messages = root.querySelector<HTMLElement>('#chat-messages')!
    this.input = root.querySelector<HTMLInputElement>('#chat-input')!
    this.status = root.querySelector<HTMLElement>('#chat-status')!
    this.scores = root.querySelector<HTMLElement>('#chat-scores')

    this.client = new DesignerClient({
      onConnection: (connected) => this.setStatus(connected),
      onState: (state) => this.syncFromState(state),
      onReply: (reply) => this.onReply(reply),
      onJudgement: (judgement) => this.onJudgement(judgement),
      onError: (error) => {
        this.removeThinking()
        this.addBubble('assistant', `⚠ ${error}`)
      },
    })

    const form = root.querySelector<HTMLFormElement>('#chat-form')!
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const text = this.input.value.trim()
      if (!text) return
      this.addBubble('user', text)
      this.input.value = ''
      this.addThinking()
      const requestId = this.client.chat(text)
      this.briefs.set(requestId, text)
    })

    const toggle = root.querySelector<HTMLElement>('#chat-toggle')
    toggle?.addEventListener('click', () => {
      root.querySelector('#chat')?.classList.toggle('collapsed')
    })
  }

  private setStatus(connected: boolean): void {
    this.status.textContent = connected ? 'conectado' : 'sin conexión'
    this.status.classList.toggle('online', connected)
  }

  /**
   * Mensajes de estado del servicio: al conectar restaura la sala guardada;
   * durante la sesión (broadcast de turnos de OTRAS pestañas) reconcilia la
   * escena si diverge. El estado del servicio es la fuente de verdad.
   */
  private syncFromState(state: DesignerRoomState): void {
    this.renderScoreboard(state.verdict ?? null)
    if (!state.room) return
    const firstState = !this.restored
    this.restored = true
    if (firstState) {
      // Estado inicial al conectar: solo se restaura sobre escena vacía
      // (no pisamos lo que el usuario ya haya montado a mano).
      if (!this.host.sceneIsEmpty()) return
      const report = this.host.apply(stateToActions(state))
      this.addBubble(
        'assistant',
        `He restaurado la habitación guardada (${report.applied} elementos del fichero del diseñador).`,
      )
      return
    }
    // Broadcast de un turno de OTRA pestaña: el estado del servicio manda.
    this.rebuildFromState(state, 'Otra sesión ha actualizado la habitación; la he sincronizado.')
  }

  private rebuildFromState(state: DesignerRoomState, note?: string): void {
    const report = this.host.apply(stateToActions(state))
    if (note) this.addBubble('assistant', note)
    if (report.skipped.length > 0) {
      this.addBubble('assistant', `⚠ ${report.skipped.length} elementos no se pudieron reconstruir.`)
    }
  }

  private onReply(reply: DesignerReply): void {
    this.removeThinking()
    let skippedCount = 0
    try {
      if (reply.actions.some((a) => a.kind === 'setRoom')) {
        // setRoom recrea el proyecto: reconstruir desde el estado completo
        // del servicio garantiza que los muebles conservados sobreviven.
        const report = this.host.apply(stateToActions(reply.state))
        skippedCount = report.skipped.length
      } else {
        const report = this.host.apply(reply.actions)
        skippedCount = report.skipped.length
      }
    } catch (error) {
      this.addBubble('assistant', `⚠ No pude aplicar los cambios: ${String(error)}`)
      return
    }
    let text = reply.reply
    if (skippedCount > 0) {
      text += ` (${skippedCount} acciones no se pudieron aplicar en la escena.)`
    }
    // Los turnos del bucle juez→agente se distinguen del diálogo con el usuario.
    if (reply.refinement) {
      this.addBubble('agent-refine', `Agente (ronda ${reply.round ?? '?'}): ${text}`)
    } else {
      this.addBubble('assistant', text)
    }

    // El juez ve la escena una vez colocados los modelos (los GLB cargan
    // async). El brief es el del ENCARGO original: en las rondas de
    // refinamiento lo fija el servidor (judgeBrief), nunca el texto del juez.
    const brief = reply.judgeBrief ?? this.briefs.get(reply.requestId) ?? ''
    this.briefs.delete(reply.requestId)
    if (reply.actions.length > 0 && brief) {
      window.setTimeout(() => {
        const image = this.host.screenshot()
        if (image.length > 100) this.client.judge(brief, image)
      }, 2500)
    } else if (reply.refinement) {
      // Ronda sin cambios aplicables: el bucle no puede seguir mejorando.
      this.addBubble('judge', 'El agente no encontró más cambios que aplicar; dejo la nota como está.')
    }
  }

  /** El veredicto llega como mensaje del juez, en lenguaje natural. */
  private onJudgement(judgement: DesignerJudgement): void {
    const { verdict } = judgement
    const bubble = this.root.createElement('div')
    bubble.className = 'chat-bubble judge verdict'
    const title = this.root.createElement('div')
    title.className = 'verdict-title'
    title.textContent = `Juez · ${judgement.mean}/10 (objetivo ${judgement.target})`
    bubble.append(title)
    const chips = this.root.createElement('div')
    chips.className = 'verdict-chips'
    for (const [label, value] of [
      ['cohesión', verdict.cohesion],
      ['colores', verdict.colors],
      ['estilo', verdict.style],
      ['brief', verdict.adherence],
    ] as const) {
      const chip = this.root.createElement('span')
      chip.className = 'verdict-chip'
      chip.textContent = `${label} ${value}`
      chips.append(chip)
    }
    bubble.append(chips)
    if (verdict.notes) {
      const notes = this.root.createElement('div')
      notes.className = 'verdict-notes'
      notes.textContent = verdict.notes
      bubble.append(notes)
    }
    const status = this.root.createElement('div')
    status.className = 'verdict-loop'
    status.textContent = judgement.refining
      ? `↻ Nota bajo el objetivo: le paso mis notas al agente (ronda ${judgement.round}).`
      : `✓ ${judgement.stopReason ?? 'evaluación registrada'}`
    bubble.append(status)
    this.messages.append(bubble)
    this.scroll()
    this.renderScoreboard({ ...verdict, mean: judgement.mean, at: '' })
    if (judgement.refining) this.addThinking()
  }

  /** Marcador persistente: las notas que lleva la habitación actual. */
  private renderScoreboard(verdict: (DesignerRoomState['verdict']) | null): void {
    if (!this.scores) return
    if (!verdict) {
      this.scores.hidden = true
      return
    }
    this.scores.hidden = false
    this.scores.replaceChildren()
    const mean = this.root.createElement('span')
    mean.className = 'score-mean'
    mean.textContent = `${verdict.mean}/10`
    this.scores.append(mean)
    for (const [label, value] of [
      ['cohesión', verdict.cohesion],
      ['colores', verdict.colors],
      ['estilo', verdict.style],
      ['brief', verdict.adherence],
    ] as const) {
      const chip = this.root.createElement('span')
      chip.className = 'score-chip'
      chip.textContent = `${label} ${value}`
      this.scores.append(chip)
    }
  }

  private addBubble(who: 'user' | 'assistant' | 'judge' | 'agent-refine', text: string): void {
    const bubble = this.root.createElement('div')
    bubble.className = `chat-bubble ${who}`
    bubble.textContent = text
    this.messages.append(bubble)
    this.scroll()
  }

  private addThinking(): void {
    const bubble = this.root.createElement('div')
    bubble.className = 'chat-bubble assistant thinking'
    bubble.id = 'chat-thinking'
    bubble.textContent = 'Diseñando…'
    this.messages.append(bubble)
    this.scroll()
  }

  private removeThinking(): void {
    this.root.querySelector('#chat-thinking')?.remove()
  }

  private scroll(): void {
    this.messages.scrollTop = this.messages.scrollHeight
  }
}
