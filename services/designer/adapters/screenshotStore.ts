import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Persistencia de los screenshots que puntúa el juez — la evidencia de cada
 * veredicto queda auditable. Doble vía como el resto del repo:
 *  - Local: carpeta data/designer/screenshots (misma forma que el bucket).
 *  - Cloud: bucket GCS (SCREENSHOT_BUCKET), subiendo por la API JSON con el
 *    token del metadata server del runtime (Cloud Run/GCE) — sin SDK.
 */
export interface ScreenshotStore {
  /** Guarda el PNG y devuelve una referencia (ruta local o URL gs://). */
  save(requestId: string, png: Buffer): Promise<string>
}

export class LocalFolderScreenshotStore implements ScreenshotStore {
  constructor(
    private readonly directory = process.env.DESIGNER_SCREENSHOT_DIR ??
      join(process.cwd(), 'data', 'designer', 'screenshots'),
  ) {}

  async save(requestId: string, png: Buffer): Promise<string> {
    await mkdir(this.directory, { recursive: true })
    const path = join(this.directory, `${Date.now().toString(36)}-${requestId}.png`)
    await writeFile(path, png)
    return path
  }
}

export class GcsScreenshotStore implements ScreenshotStore {
  constructor(
    private readonly bucket: string,
    private readonly prefix = 'designer/screenshots',
  ) {}

  async save(requestId: string, png: Buffer): Promise<string> {
    const name = `${this.prefix}/${Date.now().toString(36)}-${requestId}.png`
    const token = await metadataToken()
    const response = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
        body: new Uint8Array(png),
        signal: AbortSignal.timeout(15000),
      },
    )
    if (!response.ok) {
      throw new Error(`GCS upload ${response.status}: ${(await response.text()).slice(0, 200)}`)
    }
    return `gs://${this.bucket}/${name}`
  }
}

/** Token de la service account del runtime GCP (Cloud Run, GCE, GKE). */
async function metadataToken(): Promise<string> {
  const response = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) },
  )
  if (!response.ok) throw new Error(`metadata server HTTP ${response.status}`)
  const payload = (await response.json()) as { access_token: string }
  return payload.access_token
}

/** GCS si hay bucket configurado (cloud); carpeta local en desarrollo. */
export function screenshotStoreFromEnv(): ScreenshotStore {
  const bucket = process.env.SCREENSHOT_BUCKET
  return bucket ? new GcsScreenshotStore(bucket) : new LocalFolderScreenshotStore()
}
