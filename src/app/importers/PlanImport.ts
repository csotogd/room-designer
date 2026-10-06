import { Point2D } from '../../core/geometry/Point2D'
import { FloorPlan } from '../../core/model/FloorPlan'
import { Door } from '../../core/model/Door'
import { Window } from '../../core/model/Window'

/**
 * Importación de un plano 2D (foto o dibujo): el servicio de diseño lo lee
 * con un parser de visión y devuelve un borrador normalizado; aquí se
 * convierte en el mismo FloorPlan editable que produce el asistente, así
 * que todo lo existente (arrastrar paredes, medidas exactas, aperturas,
 * deshacer) funciona igual sobre un plano importado.
 */

export interface ParsedPlanDraft {
  corners: [number, number][]
  height: number
  openings: { wall: number; offset: number; width: number; kind: 'door' | 'window' }[]
  scaleEstimated: boolean
  confidence: number
  notes: string
  dropped: string[]
}

export interface ImportedPlan {
  plan: FloorPlan
  height: number
  /** true: la escala viene estimada; hay que confirmar una longitud real. */
  estimated: boolean
  notes: string
  /** Aperturas u observaciones que no llegaron al borrador, con su motivo. */
  skipped: string[]
}

export function planFromDraft(draft: ParsedPlanDraft): ImportedPlan {
  const corners = draft.corners.map(([x, y]) => new Point2D(x, y))
  const plan = FloorPlan.fromCorners(corners, draft.height)
  const skipped = [...(draft.dropped ?? [])]
  for (const opening of draft.openings ?? []) {
    const wall = plan.walls[opening.wall]
    const piece =
      opening.kind === 'door'
        ? new Door(opening.offset, opening.width)
        : new Window(opening.offset, opening.width)
    if (!wall || !wall.canPlaceOpening(piece, opening.offset)) {
      skipped.push(
        `No cupo una ${opening.kind === 'door' ? 'puerta' : 'ventana'} en la pared ${opening.wall + 1}.`,
      )
      continue
    }
    wall.addOpening(piece)
  }
  return {
    plan,
    height: draft.height,
    estimated: draft.scaleEstimated !== false,
    notes: draft.notes ?? '',
    skipped,
  }
}

/** Del endpoint WS del diseñador a su endpoint HTTP de lectura de planos. */
export function planParseEndpoint(designerWsUrl: string): string {
  const url = new URL(designerWsUrl)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/plan/parse'
  url.search = ''
  return url.toString()
}

export async function parsePlanImage(
  endpoint: string,
  imageDataUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<ParsedPlanDraft> {
  let response: Response
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl }),
    })
  } catch {
    throw new Error('El servicio de diseño no está disponible para leer el plano.')
  }
  const body = (await response.json().catch(() => null)) as { error?: string } | ParsedPlanDraft | null
  if (!response.ok) {
    throw new Error((body as { error?: string } | null)?.error ?? 'No se pudo leer el plano.')
  }
  if (!body || !Array.isArray((body as ParsedPlanDraft).corners)) {
    throw new Error('El servicio devolvió un plano ilegible.')
  }
  return body as ParsedPlanDraft
}
