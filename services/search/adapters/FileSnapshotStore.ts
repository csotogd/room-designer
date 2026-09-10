import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IndexSnapshot, SnapshotStore } from '../core/types'

/**
 * Persistencia de la instantánea en disco: metadatos en JSON y los vectores
 * en binario Float32 aparte (100k × 256 dims ≈ 100 MB en JSON, 25 MB en
 * binario). Escritura atómica: tmp + rename, y el meta —que referencia al
 * binario por nombre versionado— se renombra el último, así que un proceso
 * caído a medias deja el índice anterior intacto, nunca uno corrupto.
 */
export class FileSnapshotStore implements SnapshotStore {
  constructor(private readonly directory: string) {}

  async load(): Promise<IndexSnapshot | null> {
    try {
      const meta = JSON.parse(await readFile(join(this.directory, 'index.json'), 'utf8')) as {
        embedderVersion: string
        dim: number
        vectorsFile: string
        records: { id: string; contentHash: string }[]
      }
      const bytes = await readFile(join(this.directory, meta.vectorsFile))
      const vectors = new Float32Array(bytes.buffer, bytes.byteOffset, meta.records.length * meta.dim)
      return {
        embedderVersion: meta.embedderVersion,
        dim: meta.dim,
        records: meta.records,
        vectors: vectors.slice(),
      }
    } catch {
      return null
    }
  }

  async save(snapshot: IndexSnapshot): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const stamp = `${Date.now().toString(36)}-${process.pid.toString(36)}`
    const vectorsFile = `vectors-${stamp}.f32`

    const vectorsTmp = join(this.directory, `${vectorsFile}.tmp`)
    await writeFile(
      vectorsTmp,
      Buffer.from(snapshot.vectors.buffer, snapshot.vectors.byteOffset, snapshot.vectors.byteLength),
    )
    await rename(vectorsTmp, join(this.directory, vectorsFile))

    const metaTmp = join(this.directory, 'index.json.tmp')
    await writeFile(
      metaTmp,
      JSON.stringify({
        embedderVersion: snapshot.embedderVersion,
        dim: snapshot.dim,
        vectorsFile,
        records: snapshot.records,
      }),
    )
    await rename(metaTmp, join(this.directory, 'index.json'))
  }
}

export function defaultDataDir(): string {
  // Un índice por catálogo: cambiar CATALOG_SITE y reiniciar el servicio
  // restaura la instantánea de ese catálogo, sin re-embeber nada.
  const site = process.env.CATALOG_SITE ?? 'sklum'
  return process.env.SEARCH_DATA_DIR ?? join(process.cwd(), 'data', 'search-index', site)
}
