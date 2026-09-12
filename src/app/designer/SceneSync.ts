import type { DesignerRoomState, EditResult, ManualEdit, SceneSnapshot } from './actions'
import { equal, mergeScene, sceneFromState } from './scene'

export interface SceneSyncHost {
  snapshot(): SceneSnapshot
  apply(scene: SceneSnapshot): void
  send(edit: ManualEdit): void
  status(message: string, conflict: boolean): void
  saved(state: DesignerRoomState): void
}

/** One in-flight edit, a coalesced local draft, and a durable outbox per browser tab. */
export class SceneSync {
  private base: SceneSnapshot | null = null
  private local: SceneSnapshot | null = null
  private pending: ManualEdit | null = null
  private remoteConflict: DesignerRoomState | null = null
  private revision: string | null = null
  private connected = false
  private ready = false
  private gesture = false
  private blocked = ''
  private bufferedState: DesignerRoomState | null = null
  private bufferedResult: EditResult | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private deadline: ReturnType<typeof setTimeout> | undefined
  private awaiting = false
  private waiters: { resolve: () => void; reject: (error: Error) => void }[] = []

  constructor(private readonly host: SceneSyncHost, private readonly storage?: Storage,
              private readonly storageKey = 'room-designer:manual-draft') {
    const saved = storage?.getItem(storageKey)
    if (saved) {
      try {
        const draft = JSON.parse(saved)
        this.base = draft.base; this.local = draft.local; this.pending = draft.pending; this.revision = draft.revision
      } catch { this.blocked = 'No pude leer el borrador local. Recarga o conserva una copia antes de continuar.' }
    }
  }

  get currentRevision(): string { return this.revision ?? 'initial' }
  get dirty(): boolean { return !!this.local && (!this.base || !equal(this.local, this.base)) }
  get hasPending(): boolean { return this.dirty || !!this.pending || !!this.blocked }

  connection(connected: boolean): void {
    this.connected = connected
    this.ready = false
    if (!connected) {
      this.awaiting = false
      clearTimeout(this.deadline)
      this.rejectWaiters('Sin conexión. Tus ediciones siguen pendientes en esta pestaña.')
      if (this.hasPending) this.host.status('Cambios pendientes · sin conexión', false)
    }
  }

  receive(state: DesignerRoomState, preferLocal = false): void {
    if (this.gesture && this.base) { this.bufferedState = state; return }
    const remote = sceneFromState(state)
    const first = !this.ready
    this.ready = true
    if (this.blocked && !this.remoteConflict) return
    if (!this.base) {
      this.base = remote
      this.revision = state.revision ?? null
      try { this.local ??= preferLocal || !remote.room ? this.host.snapshot() : remote }
      catch (error) { this.fail(String(error)); return }
    } else if (!this.hasPending) {
      this.base = this.local = remote
      this.revision = state.revision ?? null
    }
    // A reconnect replays the SAME request id; the server deduplicates even if its ACK was lost.
    if (this.pending) {
      if (first) {
        if (this.local) this.host.apply(this.local)
        this.transmit()
      }
      return
    }
    if (!this.dirty) {
      this.host.apply(remote)
      this.host.saved(state)
    } else if (first && this.local) this.host.apply(this.local)
    this.persist()
    this.pump()
  }

  changed(): void {
    try {
      this.local = this.host.snapshot()
      if (!this.remoteConflict) this.blocked = ''
      this.persist()
      this.host.status(this.dirty ? 'Cambios pendientes' : 'Habitación guardada', !!this.remoteConflict)
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.pump(), 250)
    } catch (error) { this.fail(String(error)) }
  }

  beginGesture(): void { this.gesture = true }
  endGesture(): void {
    this.gesture = false
    const result = this.bufferedResult
    const state = this.bufferedState
    this.bufferedResult = this.bufferedState = null
    if (result) this.result(result)
    if (state) this.receive(state)
    this.pump()
  }

  flush(): Promise<void> {
    if (this.blocked) return Promise.reject(new Error(this.blocked))
    if (!this.connected || !this.ready) return Promise.reject(new Error('Espera a que se conecte la habitación.'))
    if (this.gesture) return Promise.reject(new Error('Termina el arrastre antes de enviar el encargo.'))
    clearTimeout(this.timer)
    if (!this.hasPending) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
      if (this.pending && !this.awaiting) this.transmit()
      else this.pump()
    })
  }

  result(result: EditResult): void {
    if (result.requestId !== this.pending?.requestId) return
    if (this.gesture) {
      this.bufferedResult = result
      // El ACK ya incorpora los estados anteriores en este WebSocket ordenado.
      this.bufferedState = null
      clearTimeout(this.deadline)
      return
    }
    this.awaiting = false
    clearTimeout(this.deadline)
    const sent = this.pending
    if (result.type === 'edit.conflict') {
      this.remoteConflict = result.state
      this.fail('Hay cambios simultáneos sobre el mismo objeto o plano. Elige qué conservar.', true)
      return
    }
    const remote = sceneFromState(result.state)
    try {
      const desired = mergeScene(sent.desired, this.local ?? sent.desired, remote)
      this.base = remote
      this.local = desired
      this.revision = result.state.revision ?? null
      this.pending = null
      this.blocked = ''
      // Applying a normal ACK is a no-op; it must not reset the user's drag/selection/undo.
      if (!this.gesture) this.host.apply(desired)
      this.host.saved(result.state)
      this.persist()
      this.pump()
    } catch (error) {
      this.remoteConflict = result.state
      this.fail(String(error), true)
    }
  }

  resolve(keepLocal: boolean): void {
    if (!this.remoteConflict || !this.base || !this.local) return
    const state = this.remoteConflict
    const remote = sceneFromState(state)
    this.local = keepLocal ? mergeScene(this.base, this.local, remote, true) : remote
    this.base = remote
    this.revision = state.revision ?? null
    this.pending = this.remoteConflict = null
    this.blocked = ''
    this.host.apply(this.local)
    this.host.saved(state)
    this.persist()
    this.pump()
  }

  error(requestId: string | undefined, message: string): boolean {
    if (!requestId || requestId !== this.pending?.requestId) return false
    clearTimeout(this.deadline)
    // Validation rejected the edit; retain the draft and allow a corrected scene to be sent.
    this.pending = null
    this.fail(message)
    this.persist()
    return true
  }

  private pump(): void {
    if (this.blocked || this.gesture || !this.connected || !this.ready || this.pending || !this.base || !this.local) return
    if (!this.dirty) {
      this.host.status('Habitación guardada', false)
      this.waiters.splice(0).forEach((w) => w.resolve())
      this.persist()
      return
    }
    this.pending = { requestId: crypto.randomUUID(), baseRevision: this.revision,
      base: structuredClone(this.base), desired: structuredClone(this.local) }
    this.persist()
    this.transmit()
  }

  private transmit(): void {
    if (!this.pending) return
    this.host.status('Guardando habitación…', false)
    this.awaiting = true
    this.host.send(this.pending)
    clearTimeout(this.deadline)
    this.deadline = setTimeout(() => {
      this.awaiting = false
      this.host.status('Sin confirmación del servidor. El borrador se conserva; reconecta para reintentar.', false)
      this.rejectWaiters('No se ha confirmado el guardado. No iniciaré al agente sobre un estado anterior.')
    }, 15000)
  }

  private fail(message: string, conflict = false): void {
    this.blocked = message
    this.host.status(message, conflict)
    this.rejectWaiters(message)
  }

  private rejectWaiters(message: string): void {
    this.waiters.splice(0).forEach((w) => w.reject(new Error(message)))
  }

  private persist(): void {
    if (!this.storage) return
    try {
      if (!this.dirty && !this.pending) this.storage.removeItem(this.storageKey)
      else this.storage.setItem(this.storageKey, JSON.stringify({ base: this.base, local: this.local,
        pending: this.pending, revision: this.revision }))
    } catch { this.host.status('No pude conservar el borrador local. Mantén esta pestaña abierta hasta guardar.', false) }
  }
}
