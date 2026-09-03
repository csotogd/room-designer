import { Client, handle_file } from '@gradio/client'
import { withTimeout } from '../core/withTimeout'
import type { GenerationResult, MeshGenerator, ProductDimensions } from '../core/types'

const SPACE = 'trellis-community/TRELLIS'

/**
 * Generador imagen → GLB contra el Space comunitario de TRELLIS v1 (MIT).
 * Menos fiel que TRELLIS.2 (sin PBR completo) pero con endpoint de un solo
 * paso y, normalmente, menos cola.
 */
export class TrellisV1SpaceMeshGenerator implements MeshGenerator {
  readonly name = `space:${SPACE}`

  constructor(private readonly hfToken?: string) {}

  async generate(imageAbsolutePath: string, _dims: ProductDimensions): Promise<GenerationResult> {
    const client = await withTimeout(
      Client.connect(
        SPACE,
        this.hfToken ? { hf_token: this.hfToken as `hf_${string}` } : undefined,
      ),
      120_000,
      'connect',
    )
    try {
      await withTimeout(client.predict('/start_session', {}), 60_000, 'start_session')
    } catch {
      // opcional según versión del Space
    }

    const preprocessed = await withTimeout(
      client.predict('/preprocess_image', { image: handle_file(imageAbsolutePath) }),
      240_000,
      'preprocess_image',
    )
    const processedImage = (preprocessed.data as unknown[])[0]

    const result = await withTimeout(
      // Nota: el 3er parámetro del endpoint (is_multiimage) es un gr.State sin
      // nombre: lo inyecta el servidor por sesión y no debe enviarse.
      client.predict('/generate_and_extract_glb', {
        image: processedImage,
        multiimages: [],
        seed: 42,
        ss_guidance_strength: 7.5,
        ss_sampling_steps: 12,
        slat_guidance_strength: 3.0,
        slat_sampling_steps: 12,
        multiimage_algo: 'stochastic',
        mesh_simplify: 0.95,
        texture_size: 1024,
      }),
      12 * 60_000,
      'generate_and_extract_glb',
    )

    const file = (result.data as Array<{ url?: string; path?: string } | null>)
      .filter((d) => d && (d.url ?? d.path))
      .map((d) => (d!.url ?? d!.path)!)
      .find((u) => u.endsWith('.glb'))
    if (!file) {
      throw new Error(`respuesta sin GLB: ${JSON.stringify(result.data).slice(0, 200)}`)
    }
    const response = await fetch(file)
    if (!response.ok) throw new Error(`descarga GLB: HTTP ${response.status}`)
    return { model: new Uint8Array(await response.arrayBuffer()) }
  }
}
