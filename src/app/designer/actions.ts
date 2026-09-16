/**
 * Contrato de acciones del microservicio de diseño (espejo tipado del DSL
 * del servicio, igual que ProductData refleja AppCatalogEntry). El front
 * las aplica a través del dominio: valida y deshace como cualquier edición.
 */

export interface DesignerRoomSpec {
  shape: 'rect'
  w: number
  d: number
  h: number
}

export interface DesignerOpening {
  wall: 'N' | 'S' | 'E' | 'W'
  kind: 'door' | 'window'
  offset: number
  width: number
  height?: number
  sillHeight?: number
}

export type DesignerAction =
  | { kind: 'setRoom'; room: DesignerRoomSpec; openings: DesignerOpening[] }
  | { kind: 'placeNew'; uid: string; productId: string; x: number; y?: number; z: number; rotDeg: number; query: string; reason?: string }
  | { kind: 'replace'; uid: string; productId: string; x: number; y?: number; z: number; rotDeg: number; query: string; reason?: string }
  | { kind: 'move'; uid: string; x: number; y?: number; z: number }
  | { kind: 'rotate'; uid: string; rotDeg: number }
  | { kind: 'remove'; uid: string }

export interface DesignerItem {
  uid: string
  productId: string
  x: number
  y: number
  z: number
  rotDeg: number
  supportedBy?: string | null
}

export interface DesignerZone {
  id: string
  name: string
  x: number
  z: number
  w: number
  d: number
}

export interface DesignerRoomState {
  zones?: DesignerZone[]
  zoneResults?: Record<string, { status: 'ready' | 'review' | 'furnishing'; reply: string }>


  version: 1
  revision?: string
  room: DesignerRoomSpec | null
  openings: DesignerOpening[]
  items: DesignerItem[]
  /** Última nota del juez sobre la habitación actual (si ya fue juzgada). */
  verdict?: DesignerScore
  verdicts?: DesignerScore[]
  conversation?: { role: 'user' | 'model' | 'judge'; text: string; round?: number }[]
  environment?: SceneEnvironment
}

export interface SceneEnvironment {
  timeOfDay: number
  lights: import('../serialization/ProjectSerializer').ProjectDoc['lights']
  finishes: NonNullable<import('../serialization/ProjectSerializer').ProjectDoc['finishes']>
}

export interface SceneSnapshot {
  room: DesignerRoomSpec | null
  openings: DesignerOpening[]
  items: DesignerItem[]
  environment: SceneEnvironment
}

export interface ManualEdit {
  requestId: string
  baseRevision: string | null
  base: SceneSnapshot
  desired: SceneSnapshot
}

export interface EditResult {
  type: 'edit.result' | 'edit.conflict'
  requestId: string
  state: DesignerRoomState
  conflicts?: string[]
}

export interface DesignerScore extends DesignerVerdict {
  mean: number
  at: string
  target: number
  revision?: string
  round: number
}

export interface EvaluationTicket {
  runId: string
  revision: string
}

export interface DesignerVerdict {
  cohesion: number
  colors: number
  style: number
  adherence: number
  overall: number
  notes: string
}

/** Resultado completo de un juicio: veredicto + estado del bucle de refinamiento. */
export interface DesignerJudgement {
  requestId: string
  runId: string
  revision: string
  state: DesignerRoomState
  verdict: DesignerVerdict
  /** Nota agregada de la habitación (media de las cuatro métricas). */
  mean: number
  /** Objetivo del bucle: se refina hasta alcanzarlo. */
  target: number
  /** El veredicto en una frase, como lo ve también el agente. */
  judgeText: string
  feedback: string | null
  /** true: el servidor está relanzando al agente con estas notas. */
  refining: boolean
  round: number | null
  /** Motivo del paro cuando se alcanza el objetivo. */
  stopReason: string | null
}

/** Un estado completo, expresado como las acciones que lo reconstruyen. */
export function stateToActions(state: DesignerRoomState): DesignerAction[] {
  const actions: DesignerAction[] = []
  if (state.room) actions.push({ kind: 'setRoom', room: state.room, openings: state.openings })
  for (const item of state.items) {
    actions.push({
      kind: 'placeNew',
      uid: item.uid,
      productId: item.productId,
      x: item.x,
      y: item.y,
      z: item.z,
      rotDeg: item.rotDeg,
      query: '',
    })
  }
  return actions
}
