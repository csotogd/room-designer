import { repairPlacement, validatePlacement } from './guardrails'
import { applyAction, loadRoomState, saveRoomState } from './roomFile'
import type { DesignerSearchClient } from './searchClient'
import { NULL_LOGGER, type Logger } from '../../search/core/logger'
import type {
  ActionIntent,
  CatalogSource,
  ChatTurnResult,
  DesignAction,
  DesignerBrain,
  JudgeVerdict,
  PlacedItem,
  ProductPicker,
  RoomJudge,
  RoomStateFile,
} from './types'

/**
 * Orquestador de un turno de chat:
 *
 *   brief ─▶ cerebro (LLM) ─▶ intenciones
 *     placeNew/replace: query ─▶ buscador (top-20) ─▶ picker (VLM elige por
 *     foto+precio+descripción) ─▶ posición ─▶ guardrails (validar/reparar)
 *   acciones aplicadas al fichero de la habitación (estado + log, atómico)
 *
 * Los turnos se serializan (cola de promesas): el fichero nunca ve dos
 * escrituras concurrentes. Lo que los guardrails no logran reparar se
 * devuelve como `rejected` con su motivo — nunca se aplica en silencio.
 */
export class DesignSession {
  private queue: Promise<unknown> = Promise.resolve()
  private uidCounter = 0

  constructor(
    private readonly options: {
      brain: DesignerBrain
      picker: ProductPicker
      judge: RoomJudge
      search: DesignerSearchClient
      catalog: CatalogSource & { summary?(): string }
      filePath: string
      logger?: Logger
      topK?: number
    },
  ) {}

  private get log(): Logger {
    return this.options.logger ?? NULL_LOGGER
  }

  chat(brief: string, requestId: string): Promise<ChatTurnResult> {
    const run = this.queue.then(() => this.doChat(brief, requestId))
    this.queue = run.catch(() => undefined)
    return run
  }

  judge(brief: string, screenshotPngBase64: string): Promise<JudgeVerdict> {
    return this.options.judge.judge({ brief, screenshotPngBase64 })
  }

  async state(): Promise<RoomStateFile> {
    return loadRoomState(this.options.filePath)
  }

  private async doChat(brief: string, requestId: string): Promise<ChatTurnResult> {
    const started = performance.now()
    const state = await loadRoomState(this.options.filePath)
    const catalogSummary = this.options.catalog.summary?.() ?? `${this.options.catalog.count()} productos`

    const plan = await this.options.brain.plan({ brief, state, catalogSummary })
    this.log.info('plan del cerebro', {
      requestId,
      brain: this.options.brain.version,
      intents: plan.intents.length,
    })

    const actions: DesignAction[] = []
    const rejected: ChatTurnResult['rejected'] = []
    const at = new Date().toISOString()

    for (const intent of plan.intents) {
      try {
        const action = await this.resolveIntent(intent, state, brief, requestId)
        if (!action) {
          rejected.push({ intent, reason: 'sin hueco válido tras reparación (guardrails)' })
          continue
        }
        applyAction(state, action, { requestId, source: 'assistant', at })
        actions.push(action)
        // Redimensionar la sala puede dejar muebles fuera o sobre aperturas
        // nuevas: se recolocan (move) o se retiran (remove) con acciones
        // EXPLÍCITAS, así el front y el fichero convergen siempre.
        if (action.kind === 'setRoom') {
          actions.push(...this.revalidateAfterRoomChange(state, { requestId, at }))
        }
      } catch (error) {
        rejected.push({ intent, reason: String(error) })
        this.log.warn('intención rechazada', { requestId, kind: intent.kind, error: String(error) })
      }
    }

    if (actions.length > 0) await saveRoomState(this.options.filePath, state)
    this.log.info('turno completado', {
      requestId,
      actions: actions.length,
      rejected: rejected.length,
      durationMs: Math.round(performance.now() - started),
    })

    let reply = plan.reply
    if (rejected.length > 0) {
      reply += ` (${rejected.length} propuestas no cupieron y se descartaron.)`
    }
    return { reply, actions, state, rejected }
  }

  private async resolveIntent(
    intent: ActionIntent,
    state: RoomStateFile,
    brief: string,
    requestId: string,
  ): Promise<DesignAction | null> {
    validateIntentNumbers(intent)
    switch (intent.kind) {
      case 'setRoom':
        return { kind: 'setRoom', room: intent.room, openings: intent.openings ?? [] }

      case 'placeNew': {
        const chosen = await this.chooseProduct(intent.searchQuery, brief, requestId)
        const uid = this.newUid()
        const candidate: PlacedItem = {
          uid,
          productId: chosen.productId,
          x: intent.x,
          y: 0,
          z: intent.z,
          rotDeg: intent.rotDeg,
        }
        const placed = this.fit(state, candidate)
        if (!placed) return null
        return {
          kind: 'placeNew',
          uid,
          productId: chosen.productId,
          x: placed.x,
          z: placed.z,
          rotDeg: placed.rotDeg,
          query: intent.searchQuery,
          reason: chosen.reason,
        }
      }

      case 'replace': {
        const existing = state.items.find((i) => i.uid === intent.targetUid)
        if (!existing) throw new Error(`replace: uid desconocido ${intent.targetUid}`)
        const chosen = await this.chooseProduct(intent.searchQuery, brief, requestId)
        // Mismo sitio, producto nuevo: si las medidas nuevas no caben, se repara.
        const candidate: PlacedItem = { ...existing, productId: chosen.productId }
        const placed = this.fit(state, candidate, existing.uid)
        if (!placed) return null
        return {
          kind: 'replace',
          uid: existing.uid,
          productId: chosen.productId,
          x: placed.x,
          z: placed.z,
          rotDeg: placed.rotDeg,
          query: intent.searchQuery,
          reason: chosen.reason,
        }
      }

      case 'move': {
        const existing = state.items.find((i) => i.uid === intent.targetUid)
        if (!existing) throw new Error(`move: uid desconocido ${intent.targetUid}`)
        const candidate: PlacedItem = { ...existing, x: intent.x, z: intent.z }
        // La acción move no transporta rotación: la reparación no puede girar.
        const placed = this.fit(state, candidate, existing.uid, { rotate: false })
        if (!placed) return null
        return { kind: 'move', uid: existing.uid, x: placed.x, z: placed.z }
      }

      case 'rotate': {
        const existing = state.items.find((i) => i.uid === intent.targetUid)
        if (!existing) throw new Error(`rotate: uid desconocido ${intent.targetUid}`)
        const candidate: PlacedItem = { ...existing, rotDeg: intent.rotDeg }
        const violations = validatePlacement(state, this.options.catalog, candidate, existing.uid)
        if (violations.length > 0) return null
        return { kind: 'rotate', uid: existing.uid, rotDeg: intent.rotDeg }
      }

      case 'remove': {
        const existing = state.items.find((i) => i.uid === intent.targetUid)
        if (!existing) throw new Error(`remove: uid desconocido ${intent.targetUid}`)
        return { kind: 'remove', uid: existing.uid }
      }
    }
  }

  /** query → top-k del buscador → el picker VLM elige entre los candidatos. */
  private async chooseProduct(
    query: string,
    brief: string,
    requestId: string,
  ): Promise<{ productId: string; reason: string }> {
    const candidates = await this.options.search.topCandidates(query, this.options.topK ?? 20)
    if (candidates.length === 0) throw new Error(`el buscador no devolvió candidatos para «${query}»`)
    const chosen = await this.options.picker.pick({ brief, query, candidates })
    if (!this.options.catalog.get(chosen.productId)) {
      throw new Error(`el picker eligió un producto fuera de los candidatos: ${chosen.productId}`)
    }
    this.log.debug('producto elegido', {
      requestId,
      query,
      candidates: candidates.length,
      chosen: chosen.productId,
    })
    return chosen
  }

  /**
   * Tras un setRoom, cada mueble existente se repara o se retira — nunca
   * queda inválido. applyAction es el ÚNICO mutador (estado + log), y cada
   * reparación ve las anteriores ya aplicadas.
   */
  private revalidateAfterRoomChange(
    state: RoomStateFile,
    meta: { requestId: string; at: string },
  ): DesignAction[] {
    const followUps: DesignAction[] = []
    const apply = (action: DesignAction): void => {
      applyAction(state, action, { requestId: meta.requestId, source: 'assistant', at: meta.at })
      followUps.push(action)
    }
    for (const item of [...state.items]) {
      if (validatePlacement(state, this.options.catalog, item, item.uid).length === 0) continue
      const repaired = repairPlacement(state, this.options.catalog, item, item.uid)
      if (!repaired) {
        apply({ kind: 'remove', uid: item.uid })
        continue
      }
      if (repaired.rotDeg !== item.rotDeg) {
        apply({ kind: 'rotate', uid: item.uid, rotDeg: repaired.rotDeg })
      }
      apply({ kind: 'move', uid: item.uid, x: repaired.x, z: repaired.z })
    }
    return followUps
  }

  private fit(
    state: RoomStateFile,
    item: PlacedItem,
    ignoreUid?: string,
    options?: { rotate?: boolean },
  ): PlacedItem | null {
    const violations = validatePlacement(state, this.options.catalog, item, ignoreUid)
    if (violations.length === 0) return item
    return repairPlacement(state, this.options.catalog, item, ignoreUid, options)
  }

  private newUid(): string {
    return `it-${Date.now().toString(36)}-${(this.uidCounter++).toString(36)}`
  }
}

/**
 * Un LLM puede omitir campos numéricos aunque el schema los declare (solo
 * `kind` es required): aquí se rechaza ANTES de que un undefined se cuele
 * como NaN por la geometría o se persista en el fichero.
 */
function validateIntentNumbers(intent: ActionIntent): void {
  const finite = (value: unknown, name: string): void => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`intención ${intent.kind}: ${name} no es un número finito (${String(value)})`)
    }
  }
  switch (intent.kind) {
    case 'setRoom':
      finite(intent.room?.w, 'room.w')
      finite(intent.room?.d, 'room.d')
      finite(intent.room?.h, 'room.h')
      if (intent.room.w <= 0 || intent.room.d <= 0 || intent.room.h <= 0) {
        throw new Error('setRoom: medidas no positivas')
      }
      for (const opening of intent.openings ?? []) {
        finite(opening?.offset, 'opening.offset')
        finite(opening?.width, 'opening.width')
      }
      break
    case 'placeNew':
      if (!intent.searchQuery?.trim()) throw new Error('placeNew sin searchQuery')
      finite(intent.x, 'x')
      finite(intent.z, 'z')
      finite(intent.rotDeg, 'rotDeg')
      break
    case 'replace':
      if (!intent.searchQuery?.trim()) throw new Error('replace sin searchQuery')
      break
    case 'move':
      finite(intent.x, 'x')
      finite(intent.z, 'z')
      break
    case 'rotate':
      finite(intent.rotDeg, 'rotDeg')
      break
    case 'remove':
      break
  }
}
