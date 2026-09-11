import type { CatalogSource, PlacedItem, RoomOpening, RoomSpec, RoomStateFile } from './types'

/**
 * Guardrails geométricos del diseñador. Reglas duras (el LLM propone, esto
 * dispone): nada fuera de la habitación, nada volando, nada tapando una
 * ventana o bloqueando el barrido de una puerta, y sin colisiones.
 *
 * Geometría: huella rectangular W×D rotada → se usa su AABB (conservador:
 * con rotaciones no ortogonales sobre-estima un poco; mejor rechazar de más
 * que solapar muebles). Coordenadas en metros, origen en la esquina NO de la
 * habitación, x∈[0,w], z∈[0,d].
 */

export interface Violation {
  rule: 'outside' | 'floating' | 'collision' | 'blocks-window' | 'blocks-door' | 'unknown-product'
  detail: string
}

interface Box {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Distancia libre que exige una ventana por delante (y una puerta, su barrido). */
const WINDOW_CLEARANCE = 0.75
/** Muebles por debajo del alféizar no "tapan" la ventana (mesita bajo ventana). */
const WINDOW_SILL = 0.9
/** Holgura numérica contra falsos positivos de borde. */
const EPS = 1e-6

export function footprint(item: PlacedItem, width: number, depth: number): Box {
  const rad = (item.rotDeg * Math.PI) / 180
  const halfX = (Math.abs(Math.cos(rad)) * width + Math.abs(Math.sin(rad)) * depth) / 2
  const halfZ = (Math.abs(Math.sin(rad)) * width + Math.abs(Math.cos(rad)) * depth) / 2
  return { minX: item.x - halfX, maxX: item.x + halfX, minZ: item.z - halfZ, maxZ: item.z + halfZ }
}

function overlaps(a: Box, b: Box): boolean {
  return a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS
}

/** Zona que la apertura exige libre, proyectada hacia el interior de la sala. */
function openingZone(opening: RoomOpening, room: RoomSpec): Box {
  const clearance = opening.kind === 'door' ? opening.width : WINDOW_CLEARANCE
  const from = opening.offset
  const to = opening.offset + opening.width
  switch (opening.wall) {
    case 'N': // pared z=0, mirando a +z
      return { minX: from, maxX: to, minZ: 0, maxZ: clearance }
    case 'S': // pared z=d
      return { minX: from, maxX: to, minZ: room.d - clearance, maxZ: room.d }
    case 'W': // pared x=0
      return { minX: 0, maxX: clearance, minZ: from, maxZ: to }
    case 'E': // pared x=w
      return { minX: room.w - clearance, maxX: room.w, minZ: from, maxZ: to }
  }
}

/**
 * Valida un item contra la habitación, las aperturas y el resto de muebles.
 * `ignoreUid` excluye de la colisión al propio item (move/replace/rotate).
 */
export function validatePlacement(
  state: RoomStateFile,
  catalog: CatalogSource,
  item: PlacedItem,
  ignoreUid?: string,
): Violation[] {
  const violations: Violation[] = []
  const product = catalog.get(item.productId)
  if (!product) return [{ rule: 'unknown-product', detail: item.productId }]
  if (!state.room) return [{ rule: 'outside', detail: 'no hay habitación todavía' }]
  // Un LLM puede omitir coordenadas: NaN haría pasar TODAS las comparaciones
  // (NaN < x es false), así que se rechaza explícitamente antes de comparar.
  if (![item.x, item.y, item.z, item.rotDeg].every(Number.isFinite)) {
    return [{ rule: 'outside', detail: `coordenadas no finitas: (${item.x}, ${item.y}, ${item.z}, rot ${item.rotDeg})` }]
  }

  if (Math.abs(item.y) > EPS) {
    violations.push({ rule: 'floating', detail: `y=${item.y} (los muebles van al suelo)` })
  }

  const box = footprint(item, product.width, product.depth)
  const room = state.room
  if (box.minX < -EPS || box.minZ < -EPS || box.maxX > room.w + EPS || box.maxZ > room.d + EPS) {
    violations.push({
      rule: 'outside',
      detail: `huella [${box.minX.toFixed(2)},${box.minZ.toFixed(2)}]–[${box.maxX.toFixed(2)},${box.maxZ.toFixed(2)}] fuera de ${room.w}×${room.d}`,
    })
  }

  for (const opening of state.openings) {
    if (!overlaps(box, openingZone(opening, room))) continue
    if (opening.kind === 'window' && product.height <= WINDOW_SILL) continue
    violations.push({
      rule: opening.kind === 'window' ? 'blocks-window' : 'blocks-door',
      detail: `${opening.kind} en pared ${opening.wall} (offset ${opening.offset})`,
    })
  }

  for (const other of state.items) {
    if (other.uid === item.uid || other.uid === ignoreUid) continue
    const otherProduct = catalog.get(other.productId)
    if (!otherProduct) continue
    if (overlaps(box, footprint(other, otherProduct.width, otherProduct.depth))) {
      violations.push({ rule: 'collision', detail: `colisiona con ${other.uid} (${otherProduct.name})` })
    }
  }

  return violations
}

/**
 * Reparación determinista: busca la posición válida más cercana a la
 * propuesta (anillos de 25 cm hasta 2.5 m, probando también rotación +90°).
 * Devuelve el item corregido o null si no hay hueco — en ese caso el
 * orquestador rechaza la intención y lo cuenta en el informe.
 */
export function repairPlacement(
  state: RoomStateFile,
  catalog: CatalogSource,
  item: PlacedItem,
  ignoreUid?: string,
  options?: { rotate?: boolean },
): PlacedItem | null {
  if (![item.x, item.z, item.rotDeg].every(Number.isFinite)) return null
  const grounded: PlacedItem = { ...item, y: 0 }
  const step = 0.25
  // rotate=false para `move`: la acción move no transporta rotación, así que
  // una reparación que girase el mueble desincronizaría estado y escena.
  const rotations =
    options?.rotate === false ? [grounded.rotDeg] : [grounded.rotDeg, (grounded.rotDeg + 90) % 360]
  for (let radius = 0; radius <= 2.5 + EPS; radius += step) {
    const offsets =
      radius === 0
        ? [[0, 0]]
        : ringOffsets(radius, step)
    for (const [dx, dz] of offsets) {
      for (const rot of rotations) {
        const candidate: PlacedItem = { ...grounded, x: grounded.x + dx!, z: grounded.z + dz!, rotDeg: rot }
        if (validatePlacement(state, catalog, candidate, ignoreUid).length === 0) return candidate
      }
    }
  }
  return null
}

function ringOffsets(radius: number, step: number): [number, number][] {
  const offsets: [number, number][] = []
  const points = Math.max(8, Math.round((2 * Math.PI * radius) / step))
  for (let i = 0; i < points; i++) {
    const angle = (2 * Math.PI * i) / points
    offsets.push([radius * Math.cos(angle), radius * Math.sin(angle)])
  }
  return offsets
}
