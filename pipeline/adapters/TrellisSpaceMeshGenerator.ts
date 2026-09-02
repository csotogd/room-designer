import { Client, handle_file } from '@gradio/client'
import type { MeshGenerator, ProductDimensions } from '../core/types'

const SPACE = 'microsoft/TRELLIS.2'

/**
 * Generador imagen → GLB contra el Space público de TRELLIS.2 (MIT).
 * Gratuito pero con cola ZeroGPU: lento y sin garantías — válido para
 * pruebas y lotes pequeños. En producción: mismo modelo self-host o Tripo.
 *
 * Las medidas no se usan aquí: la escala exacta la impone el visor al cargar
 * el GLB (normalización del bounding box a las medidas del catálogo).
 */
export class TrellisSpaceMeshGenerator implements MeshGenerator {
  readonly name = `space:${SPACE}`

  constructor(private readonly hfToken?: string) {}

  async generate(imageAbsolutePath: string, _dims: ProductDimensions): Promise<Uint8Array> {
    const client = await Client.connect(
      SPACE,
      this.hfToken ? { hf_token: this.hfToken as `hf_${string}` } : undefined,
    )
    try {
      await client.predict('/start_session', {})
    } catch {
      // el endpoint puede no requerirlo según versión del Space
    }

    const preprocessed = await client.predict('/preprocess_image', {
      input: handle_file(imageAbsolutePath),
    })
    const processedImage = (preprocessed.data as unknown[])[0]

    await client.predict('/image_to_3d', {
      image: processedImage,
      seed: 42,
      resolution: '1024',
      ss_guidance_strength: 7.5,
      ss_guidance_rescale: 0.7,
      ss_sampling_steps: 12,
      ss_rescale_t: 5.0,
      shape_slat_guidance_strength: 7.5,
      shape_slat_guidance_rescale: 0.5,
      shape_slat_sampling_steps: 12,
      shape_slat_rescale_t: 3.0,
      tex_slat_guidance_strength: 1.0,
      tex_slat_guidance_rescale: 0.0,
      tex_slat_sampling_steps: 12,
      tex_slat_rescale_t: 3.0,
    })

    const extracted = await client.predict('/extract_glb', {
      decimation_target: 100000,
      texture_size: 1024,
    })
    const file = (extracted.data as Array<{ url?: string; path?: string } | null>).find(
      (d) => d && (d.url || d.path),
    )
    if (!file) {
      throw new Error(`respuesta sin GLB: ${JSON.stringify(extracted.data).slice(0, 200)}`)
    }
    const response = await fetch((file.url ?? file.path)!)
    if (!response.ok) throw new Error(`descarga GLB: HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}
