import { SceneSync } from '../../app/designer/SceneSync'
import { equal } from '../../app/designer/scene'
import type { SceneSnapshot } from '../../app/designer/actions'
import { DesignerClient, type DesignerReply } from '../../app/designer/DesignerClient'
import { stateToActions, type DesignerAction, type DesignerJudgement, type DesignerRoomState, type DesignerScore } from '../../app/designer/actions'

export interface ChatPanelHost {
  apply(actions: readonly DesignerAction[]): { applied: number; skipped: { reason: string }[] }
  screenshot(): string | Promise<string>
  sceneIsEmpty(): boolean
  snapshot(): SceneSnapshot
  reconcile(scene: SceneSnapshot): void
}

/** User-visible conversation and capture handoff; the server owns the refinement policy. */
export class ChatPanel {
  private readonly sync: SceneSync
  private readonly client: DesignerClient
  private readonly messages: HTMLElement
  private readonly input: HTMLTextAreaElement
  private readonly status: HTMLElement
  private readonly scores: HTMLElement | null
  private readonly stopButton: HTMLButtonElement | null
  private pendingRequest: string | null = null
  private runId: string | null = null
  private revision: string | undefined
  private generation = 0
  private captureTimer: number | undefined
  private restored = false
  private sceneSynced = false
  private applying = false

  constructor(private readonly root: Document, private readonly host: ChatPanelHost) {
    this.messages = root.querySelector<HTMLElement>('#chat-messages')!
    this.input = root.querySelector<HTMLTextAreaElement>('#chat-input')!
    this.status = root.querySelector<HTMLElement>('#chat-status')!
    this.scores = root.querySelector<HTMLElement>('#chat-scores')
    this.stopButton = root.querySelector<HTMLButtonElement>('#chat-stop')
    this.client = new DesignerClient({
      onConnection: (connected) => {
        this.sync?.connection(connected)
        this.status.textContent = connected ? 'Disponible para ayudarte' : 'Sin conexión'
        this.status.classList.toggle('online', connected)
        if (!connected) {
          if (this.runId || this.pendingRequest) this.addBubble('assistant', 'El ciclo se ha detenido al perder la conexión.')
          this.clearCycle()
          this.restored = false
        }
      },
      onState: (state) => this.syncFromState(state),
      onReply: (reply) => this.onReply(reply),
      onJudgement: (judgement) => this.onJudgement(judgement),
      onEdit: (result) => this.sync.result(result),
      onStopped: (runId, reason) => {
        if (runId !== this.runId) return
        this.clearCycle()
        this.addBubble('assistant', reason)
      },
      onError: (error, context) => {
        if (this.sync?.error(context?.requestId, error)) return
        if (context?.state) this.sync.receive(context.state)
        if (context?.runId && context.runId !== this.runId && context.requestId !== this.pendingRequest) return
        if (context?.requestId && this.pendingRequest && context.requestId !== this.pendingRequest) return
        this.clearCycle()
        this.addBubble('assistant', `⚠ ${error}`)
      },
    })
    const syncStatus = root.createElement('div')
    syncStatus.id = 'chat-sync'
    syncStatus.setAttribute('role', 'status')
    const label = root.createElement('span')
    const mine = root.createElement('button')
    const shared = root.createElement('button')
    mine.type = shared.type = 'button'
    mine.textContent = 'Conservar mis cambios'
    shared.textContent = 'Usar versión compartida'
    mine.hidden = shared.hidden = true
    mine.addEventListener('click', () => this.sync.resolve(true))
    shared.addEventListener('click', () => this.sync.resolve(false))
    syncStatus.append(label, mine, shared)
    this.messages.after(syncStatus)
    this.sync = new SceneSync({
      snapshot: () => host.snapshot(),
      apply: (scene) => this.reconcileScene(scene),
      send: (edit) => this.client.edit(edit),
      status: (message, conflict) => {
        label.textContent = message
        mine.hidden = shared.hidden = !conflict
        if (conflict) this.setOpen(true)
      },
      saved: (state) => {
        this.revision = state.revision
        if (!this.sync.hasPending) this.renderScores(state)
      },
    }, root.defaultView?.sessionStorage, `room-designer:manual:${this.client.endpoint}`)
    root.addEventListener('pointerdown', (event) => {
      if ((event.target as Element | null)?.closest?.('#container3d, #canvas2d')) this.sync.beginGesture()
    })
    root.addEventListener('pointerup', () => this.sync.endGesture())
    root.addEventListener('pointercancel', () => this.sync.endGesture())
    const form = root.querySelector<HTMLFormElement>('#chat-form')!
    this.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
      event.preventDefault()
      form.requestSubmit()
    })
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const text = this.input.value.trim()
      if (!text) return
      this.setOpen(true)
      this.input.focus()
      if (!this.client.connected) {
        this.addBubble('assistant', 'El servicio de diseño no está conectado.')
        return
      }
      this.clearCycle()
      const generation = this.generation
      this.addThinking('Guardando tus cambios antes de diseñar…')
      this.showStop(true)
      try {
        await this.sync.flush()
        if (generation !== this.generation) return
        this.addBubble('user', text)
        this.input.value = ''
        this.pendingRequest = this.client.chat(text, this.sync.currentRevision)
        this.addThinking('Diseñando…')
      } catch (error) {
        if (generation !== this.generation) return
        this.clearCycle()
        this.addBubble('assistant', String(error))
      }
    })
    this.stopButton?.addEventListener('click', () => this.stop('Has detenido el ciclo.'))
    root.querySelector('#chat-toggle')?.addEventListener('click', () => {
      this.setOpen(false)
      root.querySelector<HTMLElement>('#chat-reopen')?.focus()
    })
    root.querySelector('#chat-reopen')?.addEventListener('click', () => {
      this.setOpen(true)
      this.input.focus()
    })
    for (const suggestion of root.querySelectorAll<HTMLButtonElement>('[data-prompt]')) {
      suggestion.addEventListener('click', () => {
        this.input.value = suggestion.dataset.prompt ?? ''
        this.input.focus()
      })
    }
    const compact = window.matchMedia?.('(max-width: 1099px)')
    this.setOpen(false)
    compact?.addEventListener('change', ({ matches }) => {
      if (matches) this.setOpen(false)
    })
  }

  setOpen(open: boolean): void {
    const panel = this.root.querySelector<HTMLElement>('#chat')!
    const dock = this.root.querySelector<HTMLElement>('#prompt-dock')
    const composer = this.root.querySelector<HTMLElement>('.chat-composer')
    const slot = this.root.querySelector<HTMLElement>('#chat-composer-slot')
    if (dock && composer && slot) {
      // Un único formulario conserva el borrador y sus listeners al cambiar de sitio.
      const destination = open ? slot : dock
      destination.append(composer)
      dock.hidden = open
    }
    panel.classList.toggle('collapsed', !open)
    panel.inert = !open
    const reopen = this.root.querySelector<HTMLElement>('#chat-reopen')
    if (reopen) {
      reopen.hidden = open
      reopen.setAttribute('aria-expanded', String(open))
    }
    this.input.placeholder = open ? 'Sigue dando forma a tu espacio…' : '¿Qué quieres construir?'
    if (open && window.matchMedia?.('(max-width: 760px)').matches) {
      const catalog = this.root.querySelector<HTMLElement>('#catalog')
      if (catalog) {
        catalog.classList.add('collapsed')
        catalog.inert = true
      }
      const catalogReopen = this.root.querySelector<HTMLElement>('#catalog-reopen')
      if (catalogReopen) catalogReopen.hidden = false
    }
  }

  /** Manual edits invalidate the relationship between server revision and rendered scene. */
  onSceneChanged(): void {
    if (this.applying) return
    this.sceneSynced = false
    if (this.runId || this.pendingRequest) this.stop('He detenido el ciclo porque has editado la habitación.')
    this.renderScores({ version: 1, room: null, openings: [], items: [] })
    this.sync.changed()
  }

  private reconcileScene(scene: SceneSnapshot): void {
    if (!scene.room) return
    let current: SceneSnapshot | null = null
    try { current = this.host.snapshot() } catch { /* a server restore can replace an unsupported local plan */ }
    if (current && equal(current, scene)) return
    this.applying = true
    try {
      if (!current || !equal(current.room, scene.room) || !equal(current.openings, scene.openings)) {
        const report = this.host.apply([{ kind: 'setRoom', room: scene.room, openings: scene.openings }])
        if (report.skipped.length) throw new Error('No pude reconstruir el plano compartido.')
      }
      this.host.reconcile(scene)
      this.sceneSynced = true
    } finally { this.applying = false }
  }

  private apply(actions: readonly DesignerAction[]) {
    this.applying = true
    try { return this.host.apply(actions) } finally { this.applying = false }
  }

  private syncFromState(state: DesignerRoomState): void {
    const first = !this.restored
    this.restored = true
    if ((first || (!this.runId && !this.pendingRequest)) && state.conversation?.length) {
      this.messages.replaceChildren()
      for (const turn of state.conversation) {
        const who = turn.role === 'judge' ? 'judge' : turn.role === 'user' ? 'user' : turn.round ? 'agent-refine' : 'assistant'
        const label = who === 'judge' ? 'Juez: ' : who === 'agent-refine' ? `Agente (ronda ${turn.round}): ` : ''
        this.addBubble(who, label + turn.text)
      }
    }
    if (!first && state.revision !== this.revision && !this.sync.hasPending) this.clearCycle()
    try {
      this.sync.receive(state, first && !this.host.sceneIsEmpty())
      this.sceneSynced = !this.sync.hasPending
    } catch (error) {
      this.addBubble('assistant', String(error))
    }
  }

  private onReply(reply: DesignerReply): void {
    if (reply.refinement ? reply.runId !== this.runId : reply.requestId !== this.pendingRequest) return
    this.pendingRequest = null
    this.runId = reply.runId
    this.removeThinking()
    try {
      const actions = !this.sceneSynced || reply.actions.some((a) => a.kind === 'setRoom')
        ? stateToActions(reply.state) : reply.actions
      const report = this.apply(actions)
      if (report.skipped.length) {
        this.stop(`No pude aplicar ${report.skipped.length} cambios; la escena necesita revisión antes de evaluarla.`)
        this.onSceneChanged()
        return
      }
      this.sceneSynced = true
      this.revision = reply.state.revision
    } catch (error) {
      this.stop(`No pude aplicar los cambios: ${String(error)}`)
      this.onSceneChanged()
      return
    }
    this.addBubble(reply.refinement ? 'agent-refine' : 'assistant',
      reply.refinement ? `Agente (ronda ${reply.round}): ${reply.reply}` : reply.reply)
    this.sync.receive(reply.state)
    this.renderScores(reply.state)
    if (!reply.state.room) {
      this.stop('Crea una habitación para que el juez pueda evaluarla.')
      return
    }
    // Even a turn without actions is evaluated; only the server decides whether the target was reached.
    const generation = ++this.generation
    this.addThinking('Preparando la imagen para el juez…')
    this.showStop(true)
    this.captureTimer = window.setTimeout(() => { void this.capture(reply, generation) }, 100)
  }

  private async capture(reply: DesignerReply, generation: number): Promise<void> {
    try {
      const image = await this.host.screenshot()
      if (generation !== this.generation || reply.runId !== this.runId) return
      if (image.length < 100) throw new Error('No se pudo capturar la habitación.')
      this.addThinking('El juez está evaluando la habitación…')
      this.client.judge(image, reply.evaluation)
    } catch (error) {
      if (generation === this.generation) this.stop(`No pude preparar la imagen: ${String(error)}`)
    }
  }

  private onJudgement(judgement: DesignerJudgement): void {
    if (judgement.runId !== this.runId || judgement.revision !== this.revision) return
    this.removeThinking()
    const bubble = this.root.createElement('div')
    bubble.className = 'chat-bubble judge verdict'
    const title = this.root.createElement('div')
    title.className = 'verdict-title'
    title.textContent = `Juez · ${this.grade(judgement.mean)}/10 (objetivo ${judgement.target})`
    bubble.append(title)
    this.appendChips(bubble, judgement.verdict, 'verdict')
    const notes = this.root.createElement('div')
    notes.className = 'verdict-notes'
    notes.textContent = judgement.verdict.notes
    bubble.append(notes)
    const status = this.root.createElement('div')
    status.className = 'verdict-loop'
    status.textContent = judgement.refining
      ? `Voy a pedir al agente otra mejora (ronda ${(judgement.round ?? 0) + 1}).`
      : `✓ ${judgement.stopReason}`
    bubble.append(status)
    if (judgement.feedback) {
      const details = this.root.createElement('details')
      const summary = this.root.createElement('summary')
      summary.textContent = 'Ver lo que el juez le pide al agente'
      details.append(summary, this.root.createTextNode(judgement.feedback))
      bubble.append(details)
    }
    this.messages.append(bubble)
    this.renderScores(judgement.state)
    this.scroll()
    if (judgement.refining) this.addThinking('El agente está aplicando las observaciones del juez…')
    else this.clearCycle()
  }

  private renderScores(state: DesignerRoomState): void {
    if (!this.scores) return
    this.scores.hidden = false
    this.scores.replaceChildren()
    const current = state.verdict
    const previous = state.verdicts?.at(-1)
    const mean = this.root.createElement('span')
    mean.className = 'score-mean'
    mean.textContent = current ? `${this.grade(current.mean)}/10 · objetivo ${current.target ?? 7}` : 'Pendiente de evaluación'
    this.scores.append(mean)
    if (current) this.appendChips(this.scores, current, 'score')
    else if (previous) {
      const last = this.root.createElement('span')
      last.className = 'score-previous'
      last.textContent = `Última versión evaluada: ${this.grade(previous.mean)}/10`
      this.scores.append(last)
    }
    if (state.verdicts?.length) {
      const history = this.root.createElement('details')
      const summary = this.root.createElement('summary')
      summary.textContent = 'Evolución de las notas'
      history.append(summary)
      for (const score of state.verdicts) {
        const row = this.root.createElement('div')
        row.textContent = `${new Date(score.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ronda ${score.round ?? 0}: ${this.grade(score.mean)}/10 — ${score.notes}`
        row.title = `Cohesión ${score.cohesion} · colores ${score.colors} · estilo ${score.style} · brief ${score.adherence}`
        history.append(row)
      }
      this.scores.append(history)
    }
  }

  private appendChips(parent: HTMLElement, verdict: Pick<DesignerScore, 'cohesion' | 'colors' | 'style' | 'adherence'>, prefix: string): void {
    const chips = this.root.createElement('div')
    chips.className = 'verdict-chips'
    for (const [label, value] of [['cohesión', verdict.cohesion], ['colores', verdict.colors], ['estilo', verdict.style], ['brief', verdict.adherence]] as const) {
      const chip = this.root.createElement('span')
      chip.className = `${prefix}-chip`
      chip.textContent = `${label} ${value}`
      chips.append(chip)
    }
    parent.append(chips)
  }

  private grade(value: number): string { return String(Math.round(value * 1000) / 1000) }

  private stop(reason: string): void {
    this.client.stop(this.runId ?? undefined)
    this.clearCycle()
    this.addBubble('assistant', reason)
  }

  private clearCycle(): void {
    ++this.generation
    window.clearTimeout(this.captureTimer)
    this.runId = null
    this.pendingRequest = null
    this.removeThinking()
    this.showStop(false)
  }

  private showStop(visible: boolean): void { if (this.stopButton) this.stopButton.hidden = !visible }

  private addBubble(who: 'user' | 'assistant' | 'judge' | 'agent-refine', text: string): void {
    if (who === 'user') this.root.querySelector<HTMLElement>('#chat-welcome')?.setAttribute('hidden', '')
    const bubble = this.root.createElement('div')
    bubble.className = `chat-bubble ${who}`
    bubble.textContent = text
    this.messages.append(bubble)
    this.scroll()
  }

  private addThinking(text: string): void {
    this.removeThinking()
    const bubble = this.root.createElement('div')
    bubble.className = 'chat-bubble assistant thinking'
    bubble.id = 'chat-thinking'
    bubble.textContent = text
    this.messages.append(bubble)
    this.scroll()
  }

  private removeThinking(): void { this.root.querySelector('#chat-thinking')?.remove() }
  private scroll(): void { this.messages.scrollTop = this.messages.scrollHeight }
}
