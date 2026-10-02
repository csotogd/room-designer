import { evaluationHistory } from './EvaluationHistory'
import { ConversationScroll } from './ConversationScroll'
import { AgentActivityPanel } from './AgentActivityPanel'
import { ZonePlanPanel } from './ZonePlanPanel'
import { SceneSync } from '../../app/designer/SceneSync'
import { equal, sceneFromState } from '../../app/designer/scene'
import type { DesignerZone, DesignerActivity, DesignerActivityProgress, SceneSnapshot } from '../../app/designer/actions'
import { DesignerClient, type DesignerReply, type DesignerProgress, type DesignerPreviewJudgement } from '../../app/designer/DesignerClient'
import { stateToActions, type DesignerAction, type DesignerJudgement, type DesignerRoomState, type DesignerScore } from '../../app/designer/actions'

export interface ChatPanelHost {
  showZones?(zones: readonly DesignerZone[]): void
  apply(actions: readonly DesignerAction[]): { applied: number; skipped: { reason: string }[] }
  screenshot(): string | Promise<string>
  sceneIsEmpty(): boolean
  snapshot(): SceneSnapshot
  reconcile(scene: SceneSnapshot): void
}

/** User-visible conversation and capture handoff; the server owns the refinement policy. */
export class ChatPanel {
  private readonly zones: ZonePlanPanel
  private readonly sync: SceneSync
  private readonly client: DesignerClient
  private readonly scrolling: ConversationScroll
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
  private committedState: DesignerRoomState | null = null
  private previewing = false
  private previewRevision: string | null = null
  private previewScores: DesignerScore[] = []
  private activity: AgentActivityPanel | null = null
  private activityRound = 0
  private activityPhase: 'design' | 'judge' = 'design'

  constructor(private readonly root: Document, private readonly host: ChatPanelHost) {
    this.messages = root.querySelector<HTMLElement>('#chat-messages')!
    this.scrolling = new ConversationScroll(this.messages)
    this.input = root.querySelector<HTMLTextAreaElement>('#chat-input')!
    this.status = root.querySelector<HTMLElement>('#chat-status')!
    this.scores = root.querySelector<HTMLElement>('#chat-scores')
    this.stopButton = root.querySelector<HTMLButtonElement>('#chat-stop')
    const zones = root.createElement('section')
    zones.id = 'chat-zones'
    zones.hidden = true
    this.messages.before(zones)
    this.zones = new ZonePlanPanel(zones)
    const freshLocalPage = import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(root.defaultView?.location.hostname ?? '')
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
      onProgress: (progress) => this.onProgress(progress),
      onPreviewJudgement: (judgement) => this.onPreviewJudgement(judgement),
      onReply: (reply) => this.onReply(reply),
      onActivity: (progress) => this.onActivity(progress),
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
    }, undefined, freshLocalPage)
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
        this.committedState = state
        this.revision = state.revision
        if (!this.sync.hasPending) {
          this.renderScores(state)
          this.renderZones(state)
        }
      },
    }, freshLocalPage ? undefined : root.defaultView?.sessionStorage, `room-designer:manual:${this.client.endpoint}`)
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
        this.startActivity(0)
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
    this.previewing = false
    this.sceneSynced = false
    if (this.runId || this.pendingRequest) this.stop('He detenido el ciclo porque has editado la habitación.')
    this.renderScores({ version: 1, room: null, openings: [], items: [] })
    this.renderZones({ version: 1, room: null, openings: [], items: [] })
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
        if (turn.activity?.length) {
          const activity = new AgentActivityPanel(this.root)
          activity.finish('Finalizado', turn.activity)
          this.messages.append(activity.element)
        }
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

  private onProgress(progress: DesignerProgress): void {
    if (progress.requestId !== this.pendingRequest && progress.runId !== this.runId) return
    this.runId = progress.runId
    this.previewing = true
    try {
      this.reconcileScene(sceneFromState(progress.state))
      this.renderZones(progress.state)
      this.addThinking(progress.state.zones?.length
        ? `Amueblando ${progress.state.zones.length} zonas en paralelo…`
        : 'Actualizando los muebles de la habitación…')
      this.renderScores({ ...progress.state, verdict: undefined,
        verdicts: [...(this.committedState?.verdicts ?? []), ...this.previewScores] })
      if (progress.evaluation) {
        this.previewRevision = progress.evaluation.revision
        this.addThinking('El juez está revisando este avance…')
        const generation = this.generation
        this.captureTimer = window.setTimeout(() => { void this.capturePreview(progress, generation) }, 100)
      }
    } catch (error) { this.stop(`No pude mostrar el progreso: ${String(error)}`) }
  }

  private async capturePreview(progress: DesignerProgress, generation: number): Promise<void> {
    try {
      const image = await this.host.screenshot()
      if (generation !== this.generation || progress.runId !== this.runId
        || progress.evaluation?.revision !== this.previewRevision) return
      if (image.length < 100) throw new Error('No se pudo capturar el avance.')
      this.client.judgePreview(image, progress.evaluation!)
    } catch (error) {
      if (generation === this.generation) this.stop(`No pude evaluar el avance: ${String(error)}`)
    }
  }

  private onPreviewJudgement(judgement: DesignerPreviewJudgement): void {
    if (judgement.runId !== this.runId || judgement.revision !== this.previewRevision) return
    this.previewRevision = null
    this.previewScores.push(judgement.verdict)
    const verdict = judgement.verdict
    this.messages.append(this.verdictBubble(verdict,
      `Juez · avance ${verdict.step} · ${this.grade(verdict.mean)}/10`))
    this.renderScores({ version: 1, room: null, items: [], openings: [], verdict,
      verdicts: [...(this.committedState?.verdicts ?? []), ...this.previewScores] })
    this.addThinking('Aplicando las correcciones del juez…')
    this.scrolling.afterAppend()
  }

  private onReply(reply: DesignerReply): void {
    if (reply.refinement ? reply.runId !== this.runId : reply.requestId !== this.pendingRequest) return
    this.restorePreview()
    this.previewRevision = null
    this.previewScores = []
    this.finishActivity('Finalizado', reply.activity)
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
    if (!reply.evaluation) {
      this.showStop(false)
      this.runId = null
      return
    }
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
      this.startActivity(reply.round ?? 0, 'judge')
      this.client.judge(image, reply.evaluation!)
    } catch (error) {
      if (generation === this.generation) this.stop(`No pude preparar la imagen: ${String(error)}`)
    }
  }

  private onJudgement(judgement: DesignerJudgement): void {
    if (judgement.runId !== this.runId || judgement.revision !== this.revision) return
    this.finishActivity('Finalizado', judgement.activity)
    this.removeThinking()
    const bubble = this.verdictBubble(judgement.verdict,
      `Juez · ${this.grade(judgement.mean)}/10 (objetivo ${judgement.target})`)
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
    this.scrolling.afterAppend()
    if (judgement.refining) this.startActivity((judgement.round ?? 0) + 1)
    else this.clearCycle()
  }

  private verdictBubble(verdict: DesignerScore | DesignerJudgement['verdict'], heading: string): HTMLElement {
    const bubble = this.root.createElement('div')
    bubble.className = 'chat-bubble judge verdict'
    const title = this.root.createElement('div')
    title.className = 'verdict-title'
    title.textContent = heading
    bubble.append(title)
    this.appendChips(bubble, verdict, 'verdict')
    const notes = this.root.createElement('div')
    notes.className = 'verdict-notes'
    notes.textContent = verdict.notes
    bubble.append(notes)
    return bubble
  }

  private renderZones(state: DesignerRoomState): void {
    this.zones.render(state)
    this.host.showZones?.(state.zones ?? [])
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
      this.scores.append(evaluationHistory(this.root, state.verdicts,
        (parent, score) => this.appendChips(parent, score, 'history')))
    }
  }

  private appendChips(parent: HTMLElement, verdict: Pick<DesignerScore, 'cohesion' | 'colors' | 'style' | 'adherence' | 'rotation' | 'completeness'>, prefix: string): void {
    const chips = this.root.createElement('div')
    chips.className = 'verdict-chips'
    for (const [label, value] of [['Cohesión', verdict.cohesion], ['Colores', verdict.colors], ['Estilo', verdict.style], ['Adecuación al encargo', verdict.adherence], ['Rotación correcta', verdict.rotation], ['Completitud', verdict.completeness]] as const) {
      const chip = this.root.createElement('span')
      chip.className = `${prefix}-chip`
      chip.textContent = `${label} ${value === undefined ? 'Sin evaluar' : `${this.grade(value)}/10`}`
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

  private restorePreview(): void {
    if (this.previewing && this.committedState) {
      this.previewing = false
      this.reconcileScene(sceneFromState(this.committedState))
      this.renderScores(this.committedState)
      this.renderZones(this.committedState)
    }
  }

  private clearCycle(): void {
    this.restorePreview()
    this.finishActivity('Interrumpido')
    this.previewRevision = null
    this.previewScores = []
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
    this.scrolling.afterAppend()
  }

  private finishActivity(status: string, entries?: readonly DesignerActivity[]): void {
    this.activity?.finish(status, entries)
    this.activity = null
  }

  private startActivity(round: number, phase: 'design' | 'judge' = 'design'): void {
    this.removeThinking()
    this.activityRound = round
    this.activityPhase = phase
    this.activity = new AgentActivityPanel(this.root)
    this.messages.append(this.activity.element)
    this.scrolling.afterAppend()
  }

  private onActivity(progress: DesignerActivityProgress): void {
    if (!this.activity || progress.round !== this.activityRound || (progress.phase ?? 'design') !== this.activityPhase) return
    if (this.pendingRequest ? progress.requestId !== this.pendingRequest : progress.runId !== this.runId) return
    this.runId = progress.runId
    this.activity.append(progress.entry)
    this.scrolling.afterAppend()
  }

  private addThinking(text: string): void {
    if (this.activity) {
      this.activity.updateStatus(text)
      return
    }
    this.removeThinking()
    const bubble = this.root.createElement('div')
    bubble.className = 'chat-bubble assistant thinking'
    bubble.id = 'chat-thinking'
    bubble.textContent = text
    this.messages.append(bubble)
    this.scrolling.afterAppend()
  }

  private removeThinking(): void { this.root.querySelector('#chat-thinking')?.remove() }
}
