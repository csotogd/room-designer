import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type {
  ActionIntent,
  CandidateProduct,
  DesignerBrain,
  JudgeVerdict,
  ProductPicker,
  RoomJudge,
  RoomStateFile,
} from '../core/types'

/**
 * Adaptadores Anthropic (SDK oficial). Tres papeles, un cliente:
 *  - Brain (LLM): brief + estado → respuesta + intenciones (structured output).
 *  - Picker (VLM): elige entre los top-k del buscador viendo la FOTO, el
 *    precio y la descripción de cada candidato — no siempre el primero.
 *  - Judge (VLM): puntúa un screenshot de la habitación con un rubric
 *    (cohesión, colores, estilo, adherencia al brief), 1–10.
 *
 * Config: ANTHROPIC_API_KEY, DESIGNER_MODEL (claude-opus-5 por defecto),
 * CATALOG_PUBLIC_DIR (public) para leer packshots locales.
 */

const MODEL = (): string => process.env.DESIGNER_MODEL ?? 'claude-opus-5'

const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'intents'],
  properties: {
    reply: { type: 'string', description: 'Respuesta conversacional al usuario, en su idioma' },
    intents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['setRoom', 'placeNew', 'replace', 'move', 'rotate', 'remove'] },
          room: {
            type: 'object',
            additionalProperties: false,
            required: ['shape', 'w', 'd', 'h'],
            properties: {
              shape: { type: 'string', enum: ['rect'] },
              w: { type: 'number' },
              d: { type: 'number' },
              h: { type: 'number' },
            },
          },
          openings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['wall', 'kind', 'offset', 'width'],
              properties: {
                wall: { type: 'string', enum: ['N', 'S', 'E', 'W'] },
                kind: { type: 'string', enum: ['door', 'window'] },
                offset: { type: 'number' },
                width: { type: 'number' },
              },
            },
          },
          searchQuery: { type: 'string', description: 'Query para el buscador del catálogo (inglés funciona mejor)' },
          role: { type: 'string', description: 'Papel del mueble en la escena' },
          targetUid: { type: 'string' },
          x: { type: 'number' },
          z: { type: 'number' },
          rotDeg: { type: 'number' },
        },
      },
    },
  },
} as const

const BRAIN_SYSTEM = `Eres el diseñador de interiores de una app 3D. Recibes el brief del usuario,
el estado actual de la habitación (JSON con muebles y sus coordenadas en metros,
origen en la esquina noroeste, x hacia el este ∈ [0,w], z hacia el sur ∈ [0,d]) y
un resumen del catálogo. Devuelves una respuesta breve y una lista de intenciones.

Reglas:
- Si no hay habitación y el brief pide crear algo, empieza con setRoom (medidas
  sensatas; ventana en una pared, puerta en otra).
- placeNew/replace llevan searchQuery: una búsqueda de producto concreta y
  descriptiva para el catálogo. El estilo pedido ("moderna", "industrial") va
  EN la query. No inventes productos: el sistema los resuelve por búsqueda.
- Propón posiciones (x, z, rotDeg) razonadas: mesas contra paredes o centradas,
  sillas frente a mesas (rotDeg mirando hacia ellas), nada delante de puertas o
  ventanas. rotDeg 0 mira al sur (+z), 90 al oeste, 180 al norte, 270 al este.
- Para move/rotate/remove/replace usa el uid EXACTO del estado.
- Un puesto de trabajo = escritorio + silla. "Para 4" = 4 puestos.`

export class AnthropicBrain implements DesignerBrain {
  readonly version = `anthropic-brain-${MODEL()}`

  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async plan(input: {
    brief: string
    state: RoomStateFile
    catalogSummary: string
  }): Promise<{ reply: string; intents: ActionIntent[] }> {
    const response = await this.client.messages.create({
      model: MODEL(),
      max_tokens: 8000,
      system: BRAIN_SYSTEM,
      output_config: { format: { type: 'json_schema', schema: INTENT_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Catálogo: ${input.catalogSummary}` },
            {
              type: 'text',
              text: `Estado actual de la habitación:\n${JSON.stringify(
                { room: input.state.room, openings: input.state.openings, items: input.state.items },
                null,
                1,
              )}`,
            },
            { type: 'text', text: `Brief del usuario: ${input.brief}` },
          ],
        },
      ],
    })
    assertNotRefusal(response)
    return JSON.parse(textOf(response)) as { reply: string; intents: ActionIntent[] }
  }
}

const PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['index', 'reason'],
  properties: {
    index: { type: 'integer', description: 'Índice del candidato elegido (0-based)' },
    reason: { type: 'string', description: 'Por qué encaja mejor con lo pedido (1 frase)' },
  },
} as const

export class AnthropicPicker implements ProductPicker {
  readonly version = `anthropic-picker-${MODEL()}`

  constructor(
    private readonly client: Anthropic = new Anthropic(),
    private readonly publicDir = process.env.CATALOG_PUBLIC_DIR ?? 'public',
    /** Tope de fotos por petición: limita coste sin perder candidatos de texto. */
    private readonly maxImages = 20,
  ) {}

  async pick(input: {
    brief: string
    query: string
    candidates: CandidateProduct[]
  }): Promise<{ productId: string; reason: string }> {
    const content: Anthropic.ContentBlockParam[] = [
      {
        type: 'text',
        text:
          `Brief del usuario: ${input.brief}\nBúsqueda: «${input.query}»\n` +
          `Elige el candidato que mejor encaje (aspecto de la FOTO, medidas, precio y descripción).`,
      },
    ]
    for (let i = 0; i < input.candidates.length; i++) {
      const candidate = input.candidates[i]!
      content.push({
        type: 'text',
        text:
          `#${i} · ${candidate.name} · ${Math.round(candidate.price)} € · ` +
          `${Math.round(candidate.width * 100)}×${Math.round(candidate.depth * 100)}×${Math.round(candidate.height * 100)} cm\n` +
          candidate.description.slice(0, 200),
      })
      if (i < this.maxImages) {
        const image = await this.imageBlock(candidate.packshotUrl ?? candidate.imageUrl)
        if (image) content.push(image)
      }
    }

    const response = await this.client.messages.create({
      model: MODEL(),
      max_tokens: 1000,
      output_config: { format: { type: 'json_schema', schema: PICK_SCHEMA } },
      messages: [{ role: 'user', content }],
    })
    assertNotRefusal(response)
    const parsed = JSON.parse(textOf(response)) as { index: number; reason: string }
    const chosen = input.candidates[parsed.index]
    if (!chosen) throw new Error(`el picker devolvió un índice inválido: ${parsed.index}`)
    return { productId: chosen.id, reason: parsed.reason }
  }

  private async imageBlock(url: string | undefined): Promise<Anthropic.ImageBlockParam | null> {
    if (!url) return null
    try {
      let bytes: Buffer
      if (/^https?:\/\//.test(url)) {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (!response.ok) return null
        bytes = Buffer.from(await response.arrayBuffer())
      } else {
        bytes = Buffer.from(await readFile(join(this.publicDir, url.replace(/^\//, ''))))
      }
      return {
        type: 'image',
        source: { type: 'base64', media_type: mediaTypeOf(url), data: bytes.toString('base64') },
      }
    } catch {
      return null // sin foto, el candidato compite solo con texto
    }
  }
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cohesion', 'colors', 'style', 'adherence', 'overall', 'notes'],
  properties: {
    cohesion: { type: 'integer', description: 'Cohesión del conjunto, 1-10' },
    colors: { type: 'integer', description: 'Armonía de colores, 1-10' },
    style: { type: 'integer', description: 'Consistencia de estilo, 1-10' },
    adherence: { type: 'integer', description: 'Adherencia a lo que pidió el usuario, 1-10' },
    overall: { type: 'integer', description: 'Nota global, 1-10' },
    notes: { type: 'string', description: 'Observaciones accionables, 2-3 frases' },
  },
} as const

export class AnthropicJudge implements RoomJudge {
  readonly version = `anthropic-judge-${MODEL()}`

  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async judge(input: { brief: string; screenshotPngBase64: string }): Promise<JudgeVerdict> {
    const response = await this.client.messages.create({
      model: MODEL(),
      max_tokens: 1500,
      output_config: { format: { type: 'json_schema', schema: JUDGE_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `Eres juez de diseño de interiores. Este es un render de la habitación montada ` +
                `para el brief: «${input.brief}». Puntúa 1-10 cada dimensión del rubric ` +
                `(cohesión, colores, estilo, adherencia al brief) y da notas accionables.`,
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: input.screenshotPngBase64,
              },
            },
          ],
        },
      ],
    })
    assertNotRefusal(response)
    return JSON.parse(textOf(response)) as JudgeVerdict
  }
}

function textOf(response: Anthropic.Message): string {
  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('respuesta sin bloque de texto')
  return block.text
}

function assertNotRefusal(response: Anthropic.Message): void {
  if (response.stop_reason === 'refusal') {
    throw new Error('el modelo declinó la petición (stop_reason: refusal)')
  }
}

function mediaTypeOf(path: string): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' {
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}
