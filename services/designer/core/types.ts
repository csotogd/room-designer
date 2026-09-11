/**
 * Tipos y puertos del microservicio de diseño conversacional ("designer").
 *
 * El estado de la habitación vive en UN fichero (muebles con coordenadas 3D
 * + el log de cambios aplicados). El chat produce ACCIONES sobre ese estado:
 * move, placeNew, replace, rotate, remove (+ setRoom para crear/redimensionar
 * la habitación desde un brief). El front las aplica a través de su dominio.
 */

// ── Estado de la habitación (el fichero) ─────────────────────────────────

export interface RoomSpec {
  shape: 'rect'
  /** Metros: ancho (x), fondo (z), alto. */
  w: number
  d: number
  h: number
}

/** Apertura sobre una pared cardinal, con offset desde el inicio de la pared. */
export interface RoomOpening {
  wall: 'N' | 'S' | 'E' | 'W'
  kind: 'door' | 'window'
  offset: number
  width: number
}

export interface PlacedItem {
  /** Id de instancia en la escena (estable entre acciones). */
  uid: string
  /** Producto del catálogo publicado (con medidas y foto reales). */
  productId: string
  /** Metros; y=0 es el suelo (nada "volando" en v1). */
  x: number
  y: number
  z: number
  rotDeg: number
}

export interface LoggedAction {
  at: string
  source: 'user' | 'assistant'
  requestId: string
  action: DesignAction
}

/** El fichero completo: estado actual + historial de cambios. */
export interface RoomStateFile {
  version: 1
  room: RoomSpec | null
  openings: RoomOpening[]
  items: PlacedItem[]
  log: LoggedAction[]
}

// ── Acciones (DSL que consume el front) ──────────────────────────────────

export type DesignAction =
  | { kind: 'setRoom'; room: RoomSpec; openings: RoomOpening[] }
  | {
      kind: 'placeNew'
      uid: string
      productId: string
      x: number
      z: number
      rotDeg: number
      /** La query que generó el LLM y la razón del picker: trazabilidad. */
      query: string
      reason?: string
    }
  | {
      kind: 'replace'
      uid: string
      productId: string
      x: number
      z: number
      rotDeg: number
      query: string
      reason?: string
    }
  | { kind: 'move'; uid: string; x: number; z: number }
  | { kind: 'rotate'; uid: string; rotDeg: number }
  | { kind: 'remove'; uid: string }

// ── Intenciones del cerebro (antes de resolver producto/posición) ────────

export type ActionIntent =
  | { kind: 'setRoom'; room: RoomSpec; openings?: RoomOpening[] }
  | {
      kind: 'placeNew'
      /** Query de búsqueda que el LLM elige para el catálogo. */
      searchQuery: string
      /** Papel en la escena ("escritorio del puesto 2"), para logs y prompts. */
      role: string
      x: number
      z: number
      rotDeg: number
    }
  | { kind: 'replace'; targetUid: string; searchQuery: string; role: string }
  | { kind: 'move'; targetUid: string; x: number; z: number }
  | { kind: 'rotate'; targetUid: string; rotDeg: number }
  | { kind: 'remove'; targetUid: string }

// ── Productos del catálogo (medidas para guardrails, foto para el picker) ─

export interface CatalogProduct {
  id: string
  name: string
  description: string
  price: number
  /** Metros. */
  width: number
  depth: number
  height: number
  imageUrl?: string
  packshotUrl?: string
}

export interface CandidateProduct extends CatalogProduct {
  /** Score del buscador (coseno). */
  score: number
}

/** Acceso del servicio al catálogo publicado (fichero local hoy, API mañana). */
export interface CatalogSource {
  get(id: string): CatalogProduct | undefined
  count(): number
}

// ── Puertos LLM/VLM ──────────────────────────────────────────────────────

/** LLM de texto: brief + estado → respuesta conversacional + intenciones. */
export interface DesignerBrain {
  readonly version: string
  plan(input: {
    brief: string
    state: RoomStateFile
    catalogSummary: string
  }): Promise<{ reply: string; intents: ActionIntent[] }>
}

/**
 * VLM selector: elige entre los top-k del buscador (foto + precio +
 * descripción) el que mejor encaja con lo pedido — para no devolver
 * siempre el primero del ranking.
 */
export interface ProductPicker {
  readonly version: string
  pick(input: {
    brief: string
    query: string
    candidates: CandidateProduct[]
  }): Promise<{ productId: string; reason: string }>
}

/** Veredicto del juez sobre un screenshot, con rubric 1–10 por dimensión. */
export interface JudgeVerdict {
  cohesion: number
  colors: number
  style: number
  adherence: number
  overall: number
  notes: string
}

/** VLM juez: puntúa la habitación renderizada contra el brief del usuario. */
export interface RoomJudge {
  readonly version: string
  judge(input: { brief: string; screenshotPngBase64: string }): Promise<JudgeVerdict>
}

// ── Resultado de un turno de chat ────────────────────────────────────────

export interface ChatTurnResult {
  reply: string
  actions: DesignAction[]
  state: RoomStateFile
  /** Intenciones descartadas por los guardrails, con el motivo (honestidad). */
  rejected: { intent: ActionIntent; reason: string }[]
}
