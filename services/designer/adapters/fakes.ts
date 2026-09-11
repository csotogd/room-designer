import type {
  ActionIntent,
  CandidateProduct,
  DesignerBrain,
  JudgeVerdict,
  ProductPicker,
  RoomJudge,
  RoomSpec,
  RoomStateFile,
} from '../core/types'

/**
 * Adaptadores deterministas sin red: mismo patrón que HashingEmbedder en el
 * buscador. Con ellos el servicio entero (chat → búsqueda → picker →
 * guardrails → fichero) funciona y se testea sin API key; el proveedor
 * Anthropic se enchufa por entorno cuando hay clave.
 */

const DEFAULT_ROOM: RoomSpec = { shape: 'rect', w: 5, d: 4, h: 2.6 }

/**
 * Cerebro por plantillas: entiende briefs de oficina/dormitorio/salón con
 * "para N", y "añade/quita X". Las posiciones salen de una plantilla simple:
 * escritorios contra la pared norte, sillas detrás, estantería al oeste.
 */
export class TemplateBrain implements DesignerBrain {
  readonly version = 'template-v1'

  plan(input: {
    brief: string
    state: RoomStateFile
    catalogSummary: string
  }): Promise<{ reply: string; intents: ActionIntent[] }> {
    const brief = input.brief.toLowerCase()
    const intents: ActionIntent[] = []
    const room = input.state.room ?? DEFAULT_ROOM

    if (!input.state.room) {
      intents.push({
        kind: 'setRoom',
        room: DEFAULT_ROOM,
        openings: [
          { wall: 'N', kind: 'window', offset: 1.5, width: 1.4 },
          { wall: 'S', kind: 'door', offset: 0.3, width: 0.9 },
        ],
      })
    }

    const seats = parseSeats(brief)
    if (/oficina|office|escritorio|desk/.test(brief)) {
      const spacing = room.w / (seats + 1)
      for (let i = 0; i < seats; i++) {
        const x = spacing * (i + 1)
        intents.push({
          kind: 'placeNew',
          searchQuery: 'wooden desk work table',
          role: `escritorio puesto ${i + 1}`,
          x,
          z: 1.3,
          rotDeg: 0,
        })
        intents.push({
          kind: 'placeNew',
          searchQuery: 'office chair',
          role: `silla puesto ${i + 1}`,
          x,
          z: 2.2,
          rotDeg: 180,
        })
      }
      intents.push({
        kind: 'placeNew',
        searchQuery: 'bookshelf shelves storage',
        role: 'estantería',
        x: 0.4,
        z: room.d / 2,
        rotDeg: 90,
      })
      intents.push({
        kind: 'placeNew',
        searchQuery: 'potted plant',
        role: 'planta decorativa',
        x: room.w - 0.4,
        z: room.d - 0.5,
        rotDeg: 0,
      })
    } else if (/dormitorio|bedroom|cama|bed/.test(brief)) {
      intents.push({
        kind: 'placeNew',
        searchQuery: 'bed frame',
        role: 'cama',
        x: room.w / 2,
        z: 1.2,
        rotDeg: 0,
      })
      intents.push({
        kind: 'placeNew',
        searchQuery: 'nightstand bedside table',
        role: 'mesita de noche',
        x: room.w / 2 - 1.4,
        z: 0.5,
        rotDeg: 0,
      })
    } else {
      const added = brief.match(/(?:añade|add|pon|coloca)\s+(?:una?\s+)?(.{3,40})/)
      if (added) {
        intents.push({
          kind: 'placeNew',
          searchQuery: added[1]!.trim(),
          role: added[1]!.trim(),
          x: room.w / 2,
          z: room.d / 2,
          rotDeg: 0,
        })
      }
    }

    const reply =
      intents.length > 0
        ? `Voy a proponer ${intents.length} cambios sobre la habitación (catálogo: ${input.catalogSummary.slice(0, 60)}…).`
        : 'No he entendido qué quieres montar; prueba con "créame una oficina para 4".'
    return Promise.resolve({ reply, intents })
  }
}

function parseSeats(brief: string): number {
  const match = brief.match(/para\s+(\d+)|for\s+(\d+)|(\d+)\s+(?:puestos|personas|people)/)
  const n = Number(match?.[1] ?? match?.[2] ?? match?.[3] ?? 2)
  return Math.max(1, Math.min(8, Number.isFinite(n) ? n : 2))
}

/**
 * Picker determinista: puntúa candidatos por score del buscador con un
 * empujón si el nombre comparte palabras con la query (proxy del criterio
 * visual del VLM real, pero reproducible en tests).
 */
export class DeterministicPicker implements ProductPicker {
  readonly version = 'deterministic-v1'

  pick(input: {
    brief: string
    query: string
    candidates: CandidateProduct[]
  }): Promise<{ productId: string; reason: string }> {
    if (input.candidates.length === 0) throw new Error('picker sin candidatos')
    const queryWords = new Set(input.query.toLowerCase().split(/\s+/))
    let best = input.candidates[0]!
    let bestScore = -Infinity
    for (const candidate of input.candidates) {
      const nameWords = candidate.name.toLowerCase().split(/\s+/)
      const overlap = nameWords.filter((w) => queryWords.has(w)).length
      const score = candidate.score + overlap * 0.1
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }
    return Promise.resolve({
      productId: best.id,
      reason: `mejor encaje léxico-visual determinista para «${input.query}»`,
    })
  }
}

/** Juez determinista: rubric fijo a partir del tamaño del brief y la imagen. */
export class ConstantJudge implements RoomJudge {
  readonly version = 'constant-v1'

  judge(input: { brief: string; screenshotPngBase64: string }): Promise<JudgeVerdict> {
    const hasImage = input.screenshotPngBase64.length > 100
    const base = hasImage ? 7 : 3
    return Promise.resolve({
      cohesion: base,
      colors: base,
      style: base,
      adherence: base + (input.brief.length > 10 ? 1 : 0),
      overall: base,
      notes: hasImage
        ? 'Veredicto determinista de test (sin VLM).'
        : 'Screenshot vacío o ilegible.',
    })
  }
}
