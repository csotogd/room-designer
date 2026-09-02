import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CatalogItem } from '../../core/model/CatalogItem'

type CacheEntry = THREE.Group | 'loading' | 'failed'

const cache = new Map<string, CacheEntry>()
const loader = new GLTFLoader()

/**
 * Modelos GLB de producto (cuando `assets.modelUrl` está definido — en
 * producción, un bucket S3/CDN). Carga perezosa con caché: mientras el GLB
 * llega (o si falla), el renderer usa la forma procedural como placeholder.
 */
export function modelFor(product: CatalogItem, onLoaded: () => void): THREE.Group | null {
  const url = product.assets.modelUrl
  if (!url) return null

  const entry = cache.get(product.id)
  if (entry instanceof THREE.Group) return entry.clone(true)
  if (entry === 'loading' || entry === 'failed') return null

  cache.set(product.id, 'loading')
  loader.load(
    url,
    (gltf) => {
      cache.set(product.id, normalizeToDimensions(gltf.scene, product))
      onLoaded()
    },
    undefined,
    () => cache.set(product.id, 'failed'),
  )
  return null
}

/**
 * Ajusta el GLB a las dimensiones reales del producto y lo centra con la
 * convención del renderer (grupo centrado; suelo local en y = -altura/2).
 */
function normalizeToDimensions(scene: THREE.Group, product: CatalogItem): THREE.Group {
  const group = new THREE.Group()
  group.add(scene)
  const bounds = new THREE.Box3().setFromObject(scene)
  const size = bounds.getSize(new THREE.Vector3())
  if (size.x > 0 && size.y > 0 && size.z > 0) {
    scene.scale.set(product.width / size.x, product.height / size.y, product.depth / size.z)
  }
  const scaled = new THREE.Box3().setFromObject(scene)
  const center = scaled.getCenter(new THREE.Vector3())
  scene.position.sub(center)
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true
      obj.receiveShadow = true
    }
  })
  return group
}
