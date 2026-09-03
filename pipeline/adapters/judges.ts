import { readFile } from 'node:fs/promises'
import type { JudgeInput, QualityJudge, QualityVerdict } from '../core/types'

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
    const images: string[] = []
    for (const path of [input.packshotPath, input.previewPath]) {
      if (path) images.push((await readFile(path)).toString('base64'))
    }
    const raw =
      this.config.provider === 'anthropic'
        ? await this.callAnthropic(images)
        : await this.callOpenAi(images)
    try {
      const parsed = JSON.parse(raw.match(/\{[^}]*\}/)?.[0] ?? raw) as QualityVerdict
      return { status: parsed.status, reason: parsed.reason, judge: this.name }
    } catch {
      return { status: 'pending', reason: `respuesta no parseable: ${raw.slice(0, 80)}`, judge: this.name }
    }
  }

  private async callAnthropic(imagesBase64: string[]): Promise<string> {
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
              ...imagesBase64.map((data) => ({
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data },
              })),
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })
    const payload = (await response.json()) as { content?: { text?: string }[] }
    if (!response.ok) throw new Error(`anthropic HTTP ${response.status}`)
    return payload.content?.[0]?.text ?? ''
  }

  private async callOpenAi(imagesBase64: string[]): Promise<string> {
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
              ...imagesBase64.map((data) => ({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${data}` },
              })),
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    if (!response.ok) throw new Error(`openai-compatible HTTP ${response.status}`)
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
