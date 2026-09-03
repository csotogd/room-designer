import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { GenerationResult, MeshGenerator, ProductDimensions } from '../core/types'

const API = 'https://api.tripo3d.ai/v2/openapi'

/**
 * Generador imagen → GLB contra la API de Tripo (de pago, céntimos/modelo).
 * Requiere TRIPO_API_KEY. Flujo: subir imagen → crear tarea image_to_model →
 * sondear hasta success → descargar el modelo PBR.
 */
export class TripoMeshGenerator implements MeshGenerator {
  readonly name = 'api:tripo'

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('TRIPO_API_KEY no definida')
  }

  async generate(imageAbsolutePath: string, _dims: ProductDimensions): Promise<GenerationResult> {
    const image = await readFile(imageAbsolutePath)
    const form = new FormData()
    form.append('file', new Blob([image], { type: 'image/jpeg' }), basename(imageAbsolutePath))
    const upload = await this.call<{ image_token: string }>('/upload/sts', { body: form })

    const task = await this.call<{ task_id: string }>('/task', {
      json: {
        type: 'image_to_model',
        file: { type: 'jpg', file_token: upload.image_token },
        texture: true,
        pbr: true,
      },
    })

    const deadline = Date.now() + 10 * 60_000
    for (;;) {
      if (Date.now() > deadline) throw new Error('timeout esperando a Tripo')
      await new Promise((resolve) => setTimeout(resolve, 4000))
      const status = await this.call<{
        status: string
        output?: { pbr_model?: string; model?: string; rendered_image?: string }
      }>(`/task/${task.task_id}`, {})
      if (status.status === 'success') {
        const url = status.output?.pbr_model ?? status.output?.model
        if (!url) throw new Error('tarea success sin URL de modelo')
        const response = await fetch(url)
        if (!response.ok) throw new Error(`descarga GLB: HTTP ${response.status}`)
        const result: GenerationResult = {
          model: new Uint8Array(await response.arrayBuffer()),
        }
        // Render de previsualización del propio proveedor: entrada del juez VLM.
        if (status.output?.rendered_image) {
          try {
            const preview = await fetch(status.output.rendered_image)
            if (preview.ok) result.preview = new Uint8Array(await preview.arrayBuffer())
          } catch {
            // sin preview no pasa nada: el juez quedará en pending
          }
        }
        return result
      }
      if (['failed', 'cancelled', 'banned', 'expired'].includes(status.status)) {
        throw new Error(`tarea Tripo terminó en estado ${status.status}`)
      }
    }
  }

  private async call<T>(
    path: string,
    options: { json?: unknown; body?: FormData },
  ): Promise<T> {
    const response = await fetch(API + path, {
      method: options.json || options.body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(options.json ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.json ? JSON.stringify(options.json) : options.body,
    })
    const payload = (await response.json()) as { code: number; data: T; message?: string }
    if (!response.ok || payload.code !== 0) {
      throw new Error(`Tripo ${path}: ${payload.message ?? response.status}`)
    }
    return payload.data
  }
}
