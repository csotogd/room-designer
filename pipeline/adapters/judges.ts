import { readFile } from 'node:fs/promises'
import type { JudgeInput, QualityJudge, QualityVerdict } from '../core/types'

interface JudgeImage {
  data: string
  mediaType: string
}

function mediaTypeOf(path: string): string {
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

/** Sin juez configurado: todo pasa (el veredicto queda auditado como no-op). */
export class NoopJudge implements QualityJudge {
  readonly name = 'noop'

  judge(_input: JudgeInput): Promise<QualityVerdict> {
    return Promise.resolve({ status: 'approved', reason: 'sin juez configurado', judge: this.name })
  }
}

export interface VlmJudgeConfig {
  /** 'anthropic' o cualquier endpoint compatible con OpenAI (chat/completions). */
  provider: 'anthropic' | 'openai'
  apiKey: string
  model: string
  /** Para proveedores OpenAI-compatibles autoalojados (vLLM, Ollama, etc.). */
  baseUrl?: string
}

const PROMPT = `Eres control de calidad de un catálogo de muebles 3D.
La primera imagen es la foto del producto real; la segunda, un render del
modelo 3D generado automáticamente. Responde SOLO un JSON:
{"status":"approved"|"rejected","reason":"<motivo breve en español>"}
Rechaza si el modelo no es el mueble de la foto, tiene geometría rota,
elementos fusionados de otros objetos, o es un bloque/plancha sin forma.`

/**
 * Juez VLM conectable a cualquier proveedor. Config por variables de entorno
 * (ver judgeFromEnv). Compara la foto del producto con el render del modelo.
 */
export class VlmJudge implements QualityJudge {
  readonly name: string

  constructor(private readonly config: VlmJudgeConfig) {
    this.name = `vlm:${config.provider}:${config.model}`
  }

  async judge(input: JudgeInput): Promise<QualityVerdict> {
    if (!input.previewPath && !input.packshotPath) {
      return { status: 'pending', reason: 'sin imágenes para juzgar', judge: this.name }
    }
    const images: JudgeImage[] = []
    for (const path of [input.packshotPath, input.previewPath]) {
      if (path) {
        images.push({
          data: (await readFile(path)).toString('base64'),
          // El media_type debe coincidir con los bytes reales (la API de
          // Anthropic lo valida): previews son .webp, fotos .jpg/.png.
          mediaType: mediaTypeOf(path),
        })
      }
    }
    const raw =
      this.config.provider === 'anthropic'
        ? await this.callAnthropic(images)
        : await this.callOpenAi(images)
    try {
      // Del primer '{' al último '}': aguanta razones con llaves y texto extra.
      const jsonSpan = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
      const parsed = JSON.parse(jsonSpan) as QualityVerdict
      if (parsed.status !== 'approved' && parsed.status !== 'rejected' && parsed.status !== 'pending') {
        return { status: 'pending', reason: `status inválido del juez: ${String(parsed.status)}`, judge: this.name }
      }
      return { status: parsed.status, reason: parsed.reason, judge: this.name }
    } catch {
      return { status: 'pending', reason: `respuesta no parseable: ${raw.slice(0, 80)}`, judge: this.name }
    }
  }

  private async callAnthropic(images: JudgeImage[]): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: [
              ...images.map((image) => ({
                type: 'image',
                source: { type: 'base64', media_type: image.mediaType, data: image.data },
              })),
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })
    // ok primero: un 502 con HTML no debe morir como SyntaxError de JSON.
    if (!response.ok) throw new Error(`anthropic HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
    const payload = (await response.json()) as { content?: { text?: string }[] }
    return payload.content?.[0]?.text ?? ''
  }

  private async callOpenAi(images: JudgeImage[]): Promise<string> {
    const base = this.config.baseUrl ?? 'https://api.openai.com/v1'
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: [
              ...images.map((image) => ({
                type: 'image_url',
                image_url: { url: `data:${image.mediaType};base64,${image.data}` },
              })),
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })
    if (!response.ok) throw new Error(`openai-compatible HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    return payload.choices?.[0]?.message?.content ?? ''
  }
}

/**
 * Juez según entorno: JUDGE_PROVIDER=anthropic|openai + JUDGE_API_KEY +
 * JUDGE_MODEL (+ JUDGE_BASE_URL para endpoints compatibles). Sin configurar,
 * no-op (aprueba todo).
 */
export function judgeFromEnv(env: NodeJS.ProcessEnv = process.env): QualityJudge {
  const provider = env.JUDGE_PROVIDER
  if (provider === 'anthropic' || provider === 'openai') {
    return new VlmJudge({
      provider,
      apiKey: env.JUDGE_API_KEY ?? '',
      model: env.JUDGE_MODEL ?? (provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o-mini'),
      baseUrl: env.JUDGE_BASE_URL,
    })
  }
  return new NoopJudge()
}
