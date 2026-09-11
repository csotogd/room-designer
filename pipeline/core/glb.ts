/**
 * Dimensiones físicas de un GLB sin dependencias: se parsea el contenedor
 * (header + chunk JSON), se recorre la escena aplicando las transformaciones
 * de cada nodo y se agregan los min/max de los accessors de POSITION. No hace
 * falta leer el chunk binario: el propio glTF publica min/max por accessor.
 *
 * Sirve para fuentes (Sketchfab) que no publican medidas del producto: el
 * modelo es la única fuente de verdad de su tamaño.
 */

interface GltfJson {
  scene?: number
  scenes?: { nodes?: number[] }[]
  nodes?: {
    children?: number[]
    mesh?: number
    matrix?: number[]
    translation?: number[]
    rotation?: number[]
    scale?: number[]
  }[]
  meshes?: { primitives?: { attributes?: Record<string, number> }[] }[]
  accessors?: { min?: number[]; max?: number[] }[]
}

export interface GlbSize {
  /** Tamaño del bounding box en unidades glTF (metros, por especificación). */
  x: number
  y: number
  z: number
}

/** Extrae el JSON de un contenedor GLB. Lanza si no es un GLB válido. */
export function parseGlbJson(bytes: Uint8Array): GltfJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
    throw new Error('No es un GLB (magic inválido)')
  }
  const chunkLength = view.getUint32(12, true)
  if (view.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error('El primer chunk del GLB no es JSON')
  }
  const jsonBytes = bytes.subarray(20, 20 + chunkLength)
  return JSON.parse(new TextDecoder().decode(jsonBytes)) as GltfJson
}

/**
 * Bounding box de la escena por defecto (o la primera). Devuelve null si el
 * glTF no tiene geometría con min/max declarados.
 */
export function glbSceneSize(gltf: GltfJson): GlbSize | null {
  const sceneNodes = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]

  const visit = (nodeIndex: number, parent: number[]): void => {
    const node = gltf.nodes?.[nodeIndex]
    if (!node) return
    const local = node.matrix ?? trsMatrix(node.translation, node.rotation, node.scale)
    const world = multiply(parent, local)
    const primitives = gltf.meshes?.[node.mesh ?? -1]?.primitives ?? []
    for (const primitive of primitives) {
      const accessor = gltf.accessors?.[primitive.attributes?.POSITION ?? -1]
      if (!accessor?.min || !accessor.max) continue
      // Las 8 esquinas del box local, transformadas al mundo.
      for (const cx of [accessor.min[0]!, accessor.max[0]!])
        for (const cy of [accessor.min[1]!, accessor.max[1]!])
          for (const cz of [accessor.min[2]!, accessor.max[2]!]) {
            const p = apply(world, cx, cy, cz)
            for (let axis = 0; axis < 3; axis += 1) {
              min[axis] = Math.min(min[axis]!, p[axis]!)
              max[axis] = Math.max(max[axis]!, p[axis]!)
            }
          }
    }
    for (const child of node.children ?? []) visit(child, world)
  }

  for (const rootNode of sceneNodes) visit(rootNode, IDENTITY)
  if (!Number.isFinite(min[0]!) || !Number.isFinite(max[0]!)) return null
  return { x: max[0]! - min[0]!, y: max[1]! - min[1]!, z: max[2]! - min[2]! }
}

export interface FurnitureDims {
  widthCm: number
  depthCm: number
  heightCm: number
}

/**
 * Convierte el tamaño del GLB a centímetros de mueble plausibles. glTF manda
 * metros, pero en la práctica (Sketchfab) hay modelos en mm, cm o pulgadas:
 * se elige el factor que deje la mayor dimensión en rango de mobiliario
 * (0.05–6 m). Si ningún factor lo consigue, no hay medidas fiables → null.
 */
export function furnitureDimsFromSize(size: GlbSize): FurnitureDims | null {
  const largest = Math.max(size.x, size.y, size.z)
  if (!(largest > 0)) return null
  for (const factor of [1, 0.01, 0.001, 0.0254, 0.1]) {
    const scaled = largest * factor
    if (scaled >= 0.05 && scaled <= 6) {
      const toCm = (meters: number) => Math.round(meters * factor * 1000) / 10
      // glTF es y-up: x=ancho, z=fondo, y=alto.
      return { widthCm: toCm(size.x), depthCm: toCm(size.z), heightCm: toCm(size.y) }
    }
  }
  return null
}

/** Dimensiones de mueble directamente desde los bytes de un GLB (o null). */
export function furnitureDimsFromGlb(bytes: Uint8Array): FurnitureDims | null {
  const size = glbSceneSize(parseGlbJson(bytes))
  return size ? furnitureDimsFromSize(size) : null
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function trsMatrix(t?: number[], r?: number[], s?: number[]): number[] {
  const [tx, ty, tz] = [t?.[0] ?? 0, t?.[1] ?? 0, t?.[2] ?? 0]
  const [qx, qy, qz, qw] = [r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0, r?.[3] ?? 1]
  const [sx, sy, sz] = [s?.[0] ?? 1, s?.[1] ?? 1, s?.[2] ?? 1]
  // Rotación de cuaternión a matriz 3×3, columnas escaladas (column-major glTF).
  const [x2, y2, z2] = [qx + qx, qy + qy, qz + qz]
  const [xx, xy, xz] = [qx * x2, qx * y2, qx * z2]
  const [yy, yz, zz] = [qy * y2, qy * z2, qz * z2]
  const [wx, wy, wz] = [qw * x2, qw * y2, qw * z2]
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0)
  for (let col = 0; col < 4; col += 1)
    for (let row = 0; row < 4; row += 1)
      for (let k = 0; k < 4; k += 1)
        out[col * 4 + row]! += a[k * 4 + row]! * b[col * 4 + k]!
  return out
}

function apply(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ]
}
