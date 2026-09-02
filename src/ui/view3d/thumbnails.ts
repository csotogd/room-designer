import * as THREE from 'three'
import type { CatalogItem } from '../../core/model/CatalogItem'
import { furnitureShape } from './builders'

const SIZE = 220
const cache = new Map<string, string>()
let renderer: THREE.WebGLRenderer | null = null

/**
 * "Foto de producto" del catálogo: si el producto trae `imageUrl` (bucket),
 * se usa esa; si no, se renderiza una miniatura del modelo 3D en un canvas
 * offscreen (misma fuente de verdad que la escena).
 */
export function productImage(product: CatalogItem): string {
  if (product.assets.imageUrl) return product.assets.imageUrl
  const cached = cache.get(product.id)
  if (cached) return cached
  const dataUrl = renderThumbnail(product)
  cache.set(product.id, dataUrl)
  return dataUrl
}

function renderThumbnail(product: CatalogItem): string {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(SIZE, SIZE)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
  }

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf7f5f1)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0a794, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(2, 3, 2.5)
  scene.add(key)

  const model = furnitureShape(product)
  scene.add(model)

  // Encuadre por esfera envolvente: el producto llena el cuadro sin cortarse.
  const radius =
    0.5 * Math.hypot(product.width, product.depth, product.height)
  const fov = 35
  const distance = (radius / Math.tan((fov * Math.PI) / 360)) * 1.12
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 50)
  camera.position
    .set(1.1, 0.75, 1.5)
    .normalize()
    .multiplyScalar(distance)
  camera.lookAt(0, 0, 0)

  renderer.render(scene, camera)
  const dataUrl = renderer.domElement.toDataURL('image/png')

  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const material of materials) material.dispose()
    }
  })
  return dataUrl
}
