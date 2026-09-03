import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { AssetStore, ScrapedProduct } from '../core/types'

/**
 * Bucket local: misma estructura de claves que tendrá S3.
 *   <root>/<site>/products.json
 *   <root>/<site>/images/<productId>.jpg
 *   <root>/<site>/models/<productId>.glb
 * El adaptador S3 del futuro implementa este mismo puerto con esas claves.
 */
export class LocalFolderAssetStore implements AssetStore {
  constructor(private readonly root: string) {}

  async saveProducts(site: string, products: ScrapedProduct[]): Promise<void> {
    const path = this.absolute(join(site, 'products.json'))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(products, null, 2))
  }

  async readProducts(site: string): Promise<ScrapedProduct[]> {
    try {
      const raw = await readFile(this.absolute(join(site, 'products.json')), 'utf8')
      return JSON.parse(raw) as ScrapedProduct[]
    } catch {
      return []
    }
  }

  async saveImage(site: string, productId: string, bytes: Uint8Array): Promise<string> {
    return this.save(join(site, 'images', `${productId}.jpg`), bytes)
  }

  async saveGenerationImage(site: string, productId: string, bytes: Uint8Array): Promise<string> {
    return this.save(join(site, 'gen-images', `${productId}.jpg`), bytes)
  }

  async saveModel(site: string, productId: string, bytes: Uint8Array): Promise<string> {
    return this.save(join(site, 'models', `${productId}.glb`), bytes)
  }

  async savePreview(site: string, productId: string, bytes: Uint8Array): Promise<string> {
    return this.save(join(site, 'previews', `${productId}.webp`), bytes)
  }

  absolute(relativePath: string): string {
    return resolve(this.root, relativePath)
  }

  private async save(relativePath: string, bytes: Uint8Array): Promise<string> {
    const path = this.absolute(relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
    return relativePath
  }
}
