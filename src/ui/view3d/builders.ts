import * as THREE from 'three'
import type { Furniture } from '../../core/model/Furniture'
import type { LightPoint } from '../../core/model/LightPoint'
import type { Opening } from '../../core/model/Opening'
import type { Polygon } from '../../core/geometry/Polygon'
import type { Wall } from '../../core/model/Wall'
import type { CatalogItem } from '../../core/model/CatalogItem'
import type { FloorFinish, WallFinish } from '../../core/model/Finishes'
import { kelvinToRgb } from './color'
import { modelFor } from './models'
import {
  brickTexture,
  concreteTexture,
  fabricTexture,
  plankTexture,
  stripeTexture,
  tileTexture,
  woodTexture,
} from './textures'

const WALL_COLOR = 0xf2eee4
const GLASS_COLOR = 0xa8cbe8
const FRAME_COLOR = 0xfdfdfd
const DOOR_COLOR = 0x9c6644

/** Qué objeto del dominio hay detrás de una malla pinchada. */
export type Pick =
  | { type: 'furniture'; furniture: Furniture }
  | { type: 'opening'; wall: Wall; opening: Opening }
  | { type: 'light'; light: LightPoint }
  | { type: 'wall'; wall: Wall }
  | { type: 'floor' }

export function pickOf(object: THREE.Object3D): Pick | null {
  let cursor: THREE.Object3D | null = object
  while (cursor) {
    if (cursor.userData.pick) return cursor.userData.pick as Pick
    cursor = cursor.parent
  }
  return null
}

/** Tinte de resaltado para hover/selección/posición inválida. */
export function tintGroup(root: THREE.Object3D, color: number, intensity: number): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial && !obj.userData.keepEmissive) {
          material.emissive.setHex(color)
          material.emissiveIntensity = intensity
        }
      }
    }
  })
}

function box(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  shadows = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
  mesh.castShadow = shadows
  mesh.receiveShadow = shadows
  return mesh
}

/**
 * Pared por tramos macizos alrededor de sus huecos (sin CSG), más las
 * carpinterías: hoja de puerta y marco+cristal de ventana como grupos
 * pinchables independientes.
 */
export function buildWall(wall: Wall, finish?: WallFinish): THREE.Group {
  const group = new THREE.Group()
  const wallMaterials: THREE.MeshStandardMaterial[] = []
  group.userData.wallMaterials = wallMaterials
  const length = wall.length()
  const height = wall.height
  const direction = wall.direction()
  const angle = Math.atan2(direction.y, direction.x)

  /** Material del acabado; con textura, la repetición se ajusta al tramo. */
  const wallMaterial = (spanW: number, spanH: number): THREE.MeshStandardMaterial => {
    let material: THREE.MeshStandardMaterial
    if (!finish || finish.material === 'paint') {
      material = new THREE.MeshStandardMaterial({
        color: finish?.color ?? WALL_COLOR,
        roughness: 0.92,
        transparent: true,
      })
    } else {
      const map = (finish.material === 'brick'
        ? brickTexture(finish.color)
        : stripeTexture(finish.color)
      ).clone()
      // Los clones se liberan al reconstruir la escena (las texturas cacheadas, no).
      map.userData.isClone = true
      map.needsUpdate = true
      if (finish.material === 'brick') map.repeat.set(spanW / 1.6, spanH / 0.9)
      else map.repeat.set(spanW / 1.2, 1)
      material = new THREE.MeshStandardMaterial({ map, roughness: 0.92, transparent: true })
    }
    wallMaterials.push(material)
    return material
  }

  const solids = new THREE.Group()
  solids.userData.pick = { type: 'wall', wall } satisfies Pick
  group.add(solids)

  const place = (mesh: THREE.Mesh, mid: number, centerY: number): void => {
    mesh.position.set(
      wall.start.x + direction.x * mid,
      centerY,
      wall.start.y + direction.y * mid,
    )
    mesh.rotation.y = -angle
  }

  const addSolid = (from: number, to: number, yBottom: number, yTop: number): void => {
    if (to - from <= 1e-4 || yTop - yBottom <= 1e-4) return
    const mesh = box(to - from, yTop - yBottom, wall.thickness, wallMaterial(to - from, yTop - yBottom))
    place(mesh, from + (to - from) / 2, yBottom + (yTop - yBottom) / 2)
    solids.add(mesh)
  }

  const openings = [...wall.openings].sort((a, b) => a.offset - b.offset)
  let cursor = 0
  for (const opening of openings) {
    addSolid(cursor, opening.offset, 0, height)
    if (opening.sillHeight > 0) addSolid(opening.offset, opening.end, 0, opening.sillHeight)
    addSolid(opening.offset, opening.end, opening.sillHeight + opening.height, height)
    group.add(buildOpeningFixture(wall, opening, place))
    cursor = opening.end
  }
  addSolid(cursor, length, 0, height)
  return group
}

/** Carpintería pinchable de una apertura (hoja de puerta o ventana con marco). */
function buildOpeningFixture(
  wall: Wall,
  opening: Opening,
  place: (mesh: THREE.Mesh, mid: number, centerY: number) => void,
): THREE.Group {
  const fixture = new THREE.Group()
  fixture.userData.pick = { type: 'opening', wall, opening } satisfies Pick
  const mid = opening.offset + opening.width / 2
  const frameMaterial = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.6 })
  const frameDepth = wall.thickness + 0.02
  const bar = 0.06

  const addFrameBar = (w: number, h: number, alongOffset: number, centerY: number): void => {
    const mesh = box(w, h, frameDepth, frameMaterial)
    place(mesh, mid + alongOffset, centerY)
    fixture.add(mesh)
  }

  const centerY = opening.sillHeight + opening.height / 2
  // jambas y dintel/antepecho
  addFrameBar(bar, opening.height, -(opening.width - bar) / 2, centerY)
  addFrameBar(bar, opening.height, (opening.width - bar) / 2, centerY)
  addFrameBar(opening.width, bar, 0, opening.sillHeight + opening.height - bar / 2)
  addFrameBar(opening.width, bar, 0, opening.sillHeight + bar / 2)

  if (opening.kind === 'door') {
    const leaf = box(
      opening.width - bar * 2,
      opening.height - bar,
      0.04,
      new THREE.MeshStandardMaterial({ color: DOOR_COLOR, roughness: 0.7 }),
    )
    place(leaf, mid, (opening.height - bar) / 2)
    fixture.add(leaf)
    const handle = box(0.12, 0.03, 0.1, new THREE.MeshStandardMaterial({ color: 0x333333 }))
    place(handle, mid + opening.width / 2 - 0.22, opening.height / 2)
    fixture.add(handle)
  } else {
    const glass = box(
      opening.width - bar,
      opening.height - bar,
      0.015,
      new THREE.MeshStandardMaterial({
        color: GLASS_COLOR,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
      }),
      false,
    )
    place(glass, mid, centerY)
    fixture.add(glass)
    const crossbar = box(opening.width - bar, 0.03, 0.02, frameMaterial)
    place(crossbar, mid, centerY)
    fixture.add(crossbar)
  }
  return fixture
}

export function buildFloor(polygon: Polygon, finish?: FloorFinish): THREE.Mesh {
  const shape = new THREE.Shape(polygon.vertices.map((v) => new THREE.Vector2(v.x, v.y)))
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(Math.PI / 2)

  const material = finish?.material ?? 'wood'
  const color = finish?.color ?? '#d9c5a3'
  const map =
    material === 'tiles'
      ? tileTexture(color)
      : material === 'carpet'
        ? fabricTexture(color)
        : material === 'concrete'
          ? concreteTexture(color)
          : plankTexture(color)
  map.repeat.set(
    material === 'tiles' ? 0.5 : material === 'carpet' ? 0.9 : material === 'concrete' ? 0.35 : 0.55,
    material === 'tiles' ? 0.5 : material === 'carpet' ? 0.9 : material === 'concrete' ? 0.35 : 0.55,
  )
  const roughness = material === 'tiles' ? 0.35 : material === 'carpet' ? 1 : 0.8
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ map, roughness, side: THREE.DoubleSide }),
  )
  mesh.position.y = 0.001
  mesh.receiveShadow = true
  mesh.userData.pick = { type: 'floor' } satisfies Pick
  return mesh
}

const wood = (color: string): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ map: woodTexture(color), roughness: 0.72 })

const fabric = (color: string): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ map: fabricTexture(color), roughness: 0.95 })

/**
 * Modelos procedurales detallados por artículo (con textura de madera/tejido).
 * Convención: el grupo está centrado; el suelo local es y = -altura/2.
 */
export function furnitureShape(item: CatalogItem): THREE.Group {
  const group = new THREE.Group()
  const { width: W, depth: D, height: H } = item
  const floor = -H / 2

  switch (item.form) {
    case 'vase': {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(W * 0.28, W * 0.45, H * 0.85, 18),
        new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.35 }),
      )
      body.position.y = floor + H * 0.42
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(W * 0.34, W * 0.24, H * 0.16, 18),
        new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.35 }),
      )
      neck.position.y = floor + H * 0.92
      body.castShadow = neck.castShadow = true
      group.add(body, neck)
      break
    }
    case 'plant': {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(W * 0.34, W * 0.27, H * 0.28, 14),
        new THREE.MeshStandardMaterial({ color: 0xb3714f, roughness: 0.85 }),
      )
      pot.position.y = floor + H * 0.14
      pot.castShadow = true
      group.add(pot)
      const leafMaterial = new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.9 })
      for (const [dx, dz, s, dy] of [
        [0, 0, 0.55, 0.62],
        [0.12, 0.08, 0.4, 0.52],
        [-0.1, -0.06, 0.42, 0.56],
        [0.05, -0.12, 0.35, 0.48],
      ] as const) {
        const tuft = new THREE.Mesh(new THREE.SphereGeometry(W * s, 10, 8), leafMaterial)
        tuft.scale.y = 1.9
        tuft.position.set(W * dx, floor + H * dy, W * dz)
        tuft.castShadow = true
        group.add(tuft)
      }
      break
    }
    case 'sofa': {
      const body = fabric(item.color)
      const base = box(W, H * 0.32, D, body)
      base.position.y = floor + H * 0.26
      const back = box(W, H * 0.62, D * 0.22, body)
      back.position.set(0, floor + H * 0.6, -D * 0.39)
      group.add(base, back)
      const cushion = fabric(shadeHex(item.color, 1.12))
      for (const side of [-1, 1]) {
        const seat = box(W * 0.42, H * 0.14, D * 0.6, cushion)
        seat.position.set(side * W * 0.22, floor + H * 0.47, D * 0.06)
        group.add(seat)
        const arm = box(W * 0.09, H * 0.52, D, body)
        arm.position.set(side * W * 0.455, floor + H * 0.4, 0)
        group.add(arm)
        for (const fz of [-1, 1]) {
          const foot = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.03, H * 0.1, 8),
            new THREE.MeshStandardMaterial({ color: 0x4a3b2d }),
          )
          foot.position.set(side * W * 0.42, floor + H * 0.05, fz * D * 0.38)
          group.add(foot)
        }
      }
      break
    }
    case 'table': {
      const top = box(W, 0.045, D, wood(item.color))
      top.position.y = H / 2 - 0.022
      group.add(top)
      const legMaterial = wood(shadeHex(item.color, 0.8))
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const leg = box(0.055, H - 0.045, 0.055, legMaterial)
        leg.position.set(sx * (W / 2 - 0.07), floor + (H - 0.045) / 2, sz * (D / 2 - 0.07))
        group.add(leg)
      }
      break
    }
    case 'chair': {
      const woodMaterial = wood(item.color)
      const seat = box(W, 0.045, D, woodMaterial)
      seat.position.y = floor + H * 0.5
      const back = box(W, H * 0.48, 0.04, woodMaterial)
      back.position.set(0, floor + H * 0.75, -D / 2 + 0.02)
      group.add(seat, back)
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const leg = box(0.04, H * 0.5, 0.04, woodMaterial)
        leg.position.set(sx * (W / 2 - 0.04), floor + H * 0.25, sz * (D / 2 - 0.04))
        group.add(leg)
      }
      break
    }
    case 'bed': {
      const frame = box(W, H * 0.4, D, wood('#8a6a4f'))
      frame.position.y = floor + H * 0.2
      const mattress = box(W * 0.96, H * 0.45, D * 0.97, fabric('#f4f1ea'))
      mattress.position.y = floor + H * 0.62
      const duvet = box(W * 0.98, H * 0.22, D * 0.62, fabric(item.color))
      duvet.position.set(0, floor + H * 0.78, D * 0.17)
      const headboard = box(W, H * 1.7, 0.06, wood('#8a6a4f'))
      headboard.position.set(0, floor + H * 0.85, -D / 2 + 0.03)
      group.add(frame, mattress, duvet, headboard)
      for (const side of [-1, 1]) {
        const pillow = box(W * 0.36, H * 0.16, D * 0.14, fabric('#ffffff'))
        pillow.position.set(side * W * 0.22, floor + H * 0.93, -D * 0.34)
        pillow.rotation.x = -0.15
        group.add(pillow)
      }
      break
    }
    case 'wardrobe': {
      const body = box(W, H, D, wood(item.color))
      group.add(body)
      const doorMaterial = wood(shadeHex(item.color, 1.15))
      for (const side of [-1, 1]) {
        const door = box(W * 0.46, H * 0.94, 0.02, doorMaterial)
        door.position.set(side * W * 0.24, 0, D / 2 + 0.005)
        group.add(door)
        const handle = box(0.02, 0.14, 0.02, new THREE.MeshStandardMaterial({ color: 0x333333 }))
        handle.position.set(side * W * 0.06, 0, D / 2 + 0.03)
        group.add(handle)
      }
      break
    }
    case 'shelf': {
      const woodMaterial = wood(item.color)
      for (const side of [-1, 1]) {
        const panel = box(0.03, H, D, woodMaterial)
        panel.position.x = side * (W / 2 - 0.015)
        group.add(panel)
      }
      const backPanel = box(W, H, 0.015, wood(shadeHex(item.color, 0.85)))
      backPanel.position.z = -D / 2 + 0.008
      group.add(backPanel)
      for (let i = 0; i < 5; i++) {
        const board = box(W - 0.06, 0.025, D, woodMaterial)
        board.position.y = floor + 0.02 + (i * (H - 0.04)) / 4
        group.add(board)
      }
      break
    }
    case 'sideboard': {
      const body = box(W, H * 0.85, D, wood(item.color))
      body.position.y = floor + H * 0.85 * 0.5 + H * 0.1
      group.add(body)
      const doorMaterial = wood(shadeHex(item.color, 1.2))
      for (const side of [-1, 1]) {
        const door = box(W * 0.47, H * 0.72, 0.02, doorMaterial)
        door.position.set(side * W * 0.245, floor + H * 0.55, D / 2 + 0.005)
        group.add(door)
      }
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const leg = box(0.035, H * 0.1, 0.035, new THREE.MeshStandardMaterial({ color: 0x3a3a3a }))
        leg.position.set(sx * (W / 2 - 0.05), floor + H * 0.05, sz * (D / 2 - 0.05))
        group.add(leg)
      }
      break
    }
    case 'tv': {
      const screen = box(W, H * 0.8, 0.04, new THREE.MeshStandardMaterial({
        color: 0x10101a,
        roughness: 0.25,
        metalness: 0.4,
      }))
      screen.position.y = floor + H * 0.55
      const neck = box(0.06, H * 0.12, 0.05, new THREE.MeshStandardMaterial({ color: 0x2b2b2b }))
      neck.position.y = floor + H * 0.09
      const foot = box(W * 0.4, 0.02, D * 2.2, new THREE.MeshStandardMaterial({ color: 0x2b2b2b }))
      foot.position.y = floor + 0.01
      group.add(screen, neck, foot)
      break
    }
    case 'rug': {
      const mat = new THREE.Mesh(
        new THREE.BoxGeometry(W, H, D),
        fabric(item.color),
      )
      mat.receiveShadow = true
      group.add(mat)
      break
    }
    case 'stool': {
      const seat = new THREE.Mesh(
        new THREE.CylinderGeometry(W * 0.45, W * 0.4, 0.05, 16),
        wood(item.color),
      )
      seat.position.y = H / 2 - 0.025
      seat.castShadow = true
      group.add(seat)
      for (let i = 0; i < 3; i++) {
        const angle = (i * Math.PI * 2) / 3
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.025, H - 0.05, 8),
          wood(shadeHex(item.color, 0.8)),
        )
        leg.position.set(Math.cos(angle) * W * 0.3, floor + (H - 0.05) / 2, Math.sin(angle) * W * 0.3)
        leg.castShadow = true
        group.add(leg)
      }
      break
    }
    case 'bench': {
      const slab = box(W, 0.06, D, wood(item.color))
      slab.position.y = H / 2 - 0.03
      group.add(slab)
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const leg = box(0.05, H - 0.06, 0.05, wood(shadeHex(item.color, 0.8)))
        leg.position.set(sx * (W / 2 - 0.08), floor + (H - 0.06) / 2, sz * (D / 2 - 0.06))
        group.add(leg)
      }
      break
    }
    case 'pouf': {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(W * 0.5, W * 0.46, H * 0.9, 20),
        fabric(item.color),
      )
      body.position.y = floor + H * 0.45
      body.castShadow = true
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(W * 0.48, W * 0.5, H * 0.12, 20),
        fabric(shadeHex(item.color, 1.1)),
      )
      top.position.y = floor + H * 0.95
      group.add(body, top)
      break
    }
    case 'mirror': {
      const frame = box(W, H * 0.96, 0.03, wood('#8a6a4f'))
      frame.position.y = H * 0.02
      const glass = box(W * 0.88, H * 0.86, 0.01, new THREE.MeshStandardMaterial({
        color: 0xcfe0e8,
        metalness: 0.9,
        roughness: 0.08,
      }))
      glass.position.set(0, H * 0.02, 0.02)
      frame.rotation.x = glass.rotation.x = -0.06
      group.add(frame, glass)
      for (const side of [-1, 1]) {
        const foot = box(0.04, 0.02, D * 2.2, new THREE.MeshStandardMaterial({ color: 0x555555 }))
        foot.position.set(side * W * 0.35, floor + 0.01, 0)
        group.add(foot)
      }
      break
    }
    default: {
      const body = box(W, H, D, wood(item.color))
      group.add(body)
    }
  }
  return group
}

function shadeHex(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const channel = (c: number) =>
    Math.min(255, Math.max(0, Math.round(c * factor)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel((n >> 16) & 255)}${channel((n >> 8) & 255)}${channel(n & 255)}`
}

/**
 * Mueble pinchable con las medidas reales del artículo. Si el producto tiene
 * modelo GLB, se usa (cargado en diferido); si no, su forma procedural.
 */
export function buildFurniture(furniture: Furniture, onModelLoaded?: () => void): THREE.Group {
  const group =
    (onModelLoaded && modelFor(furniture.item, onModelLoaded)) || furnitureShape(furniture.item)
  group.userData.pick = { type: 'furniture', furniture } satisfies Pick
  group.position.set(
    furniture.position.x,
    furniture.position.y + furniture.item.height / 2,
    furniture.position.z,
  )
  group.rotation.y = -furniture.rotationY
  return group
}

/** Fantasma translúcido para el modo de colocación. */
export function buildGhost(item: CatalogItem, valid: boolean): THREE.Group {
  const group = furnitureShape(item)
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = false
      obj.material = new THREE.MeshStandardMaterial({
        color: valid ? 0x2e7d32 : 0xc0392b,
        transparent: true,
        opacity: 0.45,
      })
    }
  })
  return group
}

/** Geometría visible de la luminaria + su fuente de luz, pinchable. */
export function buildLight(light: LightPoint): THREE.Group {
  const group = new THREE.Group()
  group.userData.pick = { type: 'light', light } satisfies Pick
  const [r, g, b] = kelvinToRgb(light.temperatureK)
  const color = new THREE.Color(r, g, b)
  const emissive = new THREE.MeshStandardMaterial({
    color: 0xf0ead6,
    emissive: light.on ? color : new THREE.Color(0x000000),
    emissiveIntensity: light.on ? 1.2 : 0,
  })

  const { x, y, z } = light.position
  let sourceY = y

  if (light.kind === 'ceiling') {
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.09, 20), emissive)
    shade.position.set(x, y - 0.05, z)
    shade.userData.keepEmissive = true
    group.add(shade)
    sourceY = y - 0.2
  } else if (light.kind === 'wall') {
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), emissive)
    shade.position.set(x, y, z)
    shade.userData.keepEmissive = true
    group.add(shade)
  } else {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.025, y, 8),
      new THREE.MeshStandardMaterial({ color: 0x444444 }),
    )
    pole.position.set(x, y / 2, z)
    pole.castShadow = true
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.16, 0.02, 16),
      new THREE.MeshStandardMaterial({ color: 0x444444 }),
    )
    base.position.set(x, 0.01, z)
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.22, 18, 1, true), emissive)
    shade.position.set(x, y, z)
    shade.userData.keepEmissive = true
    group.add(pole, base, shade)
    sourceY = y - 0.05
  }

  if (light.on && light.intensity > 0) {
    const intensityByKind = { ceiling: 30, wall: 12, floor: 18 } as const
    const source = new THREE.PointLight(color, intensityByKind[light.kind] * light.intensity, 0, 2)
    source.position.set(x, sourceY, z)
    group.add(source)
  }
  return group
}
