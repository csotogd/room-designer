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
}

export type DesignerAction =
  | { kind: 'setRoom'; room: DesignerRoomSpec; openings: DesignerOpening[] }
  | { kind: 'placeNew'; uid: string; productId: string; x: number; z: number; rotDeg: number; query: string; reason?: string }
  | { kind: 'replace'; uid: string; productId: string; x: number; z: number; rotDeg: number; query: string; reason?: string }
  | { kind: 'move'; uid: string; x: number; z: number }
  | { kind: 'rotate'; uid: string; rotDeg: number }
  | { kind: 'remove'; uid: string }

export interface DesignerItem {
  uid: string
  productId: string
  x: number
  y: number
  z: number
  rotDeg: number
}

export interface DesignerRoomState {
  version: 1
  room: DesignerRoomSpec | null
  openings: DesignerOpening[]
  items: DesignerItem[]
}

export interface DesignerVerdict {
  cohesion: number
  colors: number
  style: number
  adherence: number
  overall: number
  notes: string
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
      z: item.z,
      rotDeg: item.rotDeg,
      query: '',
    })
  }
  return actions
}
