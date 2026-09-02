import * as THREE from 'three'

const cache = new Map<string, THREE.CanvasTexture>()

function makeTexture(
  key: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  const cached = cache.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  draw(canvas.getContext('2d')!, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  cache.set(key, texture)
  return texture
}

/** Ruido determinista barato (sin Math.random: mismas texturas en cada carga). */
function noise(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const channel = (c: number) => Math.min(255, Math.max(0, Math.round(c * factor)))
  return `rgb(${channel((n >> 16) & 255)},${channel((n >> 8) & 255)},${channel(n & 255)})`
}

/** Veta de madera vertical sobre el color base del artículo. */
export function woodTexture(base: string): THREE.CanvasTexture {
  return makeTexture(`wood-${base}`, 256, (ctx, size) => {
    const rand = noise(7)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    for (let i = 0; i < 46; i++) {
      const x = rand() * size
      const width = 1 + rand() * 3
      ctx.strokeStyle = shade(base, 0.75 + rand() * 0.45)
      ctx.globalAlpha = 0.35
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.bezierCurveTo(x + 8 * rand() - 4, size * 0.33, x - 8 * rand() + 4, size * 0.66, x, size)
      ctx.stroke()
    }
    ctx.globalAlpha = 0.5
    for (let i = 0; i < 4; i++) {
      const x = rand() * size
      const y = rand() * size
      ctx.strokeStyle = shade(base, 0.6)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.ellipse(x, y, 3 + rand() * 4, 6 + rand() * 6, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  })
}

/** Trama de tejido sutil sobre el color base. */
export function fabricTexture(base: string): THREE.CanvasTexture {
  return makeTexture(`fabric-${base}`, 128, (ctx, size) => {
    const rand = noise(13)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    for (let y = 0; y < size; y += 2) {
      ctx.strokeStyle = shade(base, 0.9 + (y % 4 === 0 ? 0.15 : 0))
      ctx.globalAlpha = 0.3
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(size, y)
      ctx.stroke()
    }
    for (let x = 0; x < size; x += 2) {
      ctx.strokeStyle = shade(base, 0.85)
      ctx.globalAlpha = 0.15
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, size)
      ctx.stroke()
    }
    ctx.globalAlpha = 0.12
    for (let i = 0; i < 250; i++) {
      ctx.fillStyle = rand() > 0.5 ? shade(base, 1.2) : shade(base, 0.7)
      ctx.fillRect(rand() * size, rand() * size, 1, 1)
    }
    ctx.globalAlpha = 1
  })
}

/** Tarima de madera para el suelo: lamas con juntas escalonadas. */
export function plankTexture(base = '#d9c5a3'): THREE.CanvasTexture {
  return makeTexture(`planks-${base}`, 512, (ctx, size) => {
    const rand = noise(29)
    const grain = shade(base, 0.82)
    const plankH = size / 4
    for (let row = 0; row < 4; row++) {
      ctx.fillStyle = shade(base, 0.92 + rand() * 0.16)
      ctx.fillRect(0, row * plankH, size, plankH)
      ctx.globalAlpha = 0.25
      for (let i = 0; i < 24; i++) {
        ctx.strokeStyle = shade(grain, 0.8 + rand() * 0.4)
        ctx.lineWidth = 1 + rand() * 2
        const y = row * plankH + rand() * plankH
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(size, y + rand() * 6 - 3)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = 'rgba(60, 47, 34, 0.5)'
      ctx.fillRect(0, row * plankH, size, 2)
      const joint = ((row * 0.37 + 0.2) % 1) * size
      ctx.fillRect(joint, row * plankH, 2, plankH)
    }
  })
}

/** Baldosas con junta, para el suelo. */
export function tileTexture(base: string): THREE.CanvasTexture {
  return makeTexture(`tiles-${base}`, 512, (ctx, size) => {
    const rand = noise(41)
    const tiles = 4
    const tile = size / tiles
    for (let row = 0; row < tiles; row++) {
      for (let col = 0; col < tiles; col++) {
        ctx.fillStyle = shade(base, 0.94 + rand() * 0.12)
        ctx.fillRect(col * tile, row * tile, tile, tile)
      }
    }
    ctx.strokeStyle = shade(base, 0.62)
    ctx.lineWidth = 3
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath()
      ctx.moveTo(i * tile, 0)
      ctx.lineTo(i * tile, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i * tile)
      ctx.lineTo(size, i * tile)
      ctx.stroke()
    }
  })
}

/** Ladrillo visto con llagas de mortero, para paredes. */
export function brickTexture(base: string): THREE.CanvasTexture {
  return makeTexture(`brick-${base}`, 512, (ctx, size) => {
    const rand = noise(53)
    const rows = 8
    const brickH = size / rows
    const brickW = size / 4
    ctx.fillStyle = shade(base, 0.55)
    ctx.fillRect(0, 0, size, size)
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : brickW / 2
      for (let col = -1; col < 5; col++) {
        ctx.fillStyle = shade(base, 0.85 + rand() * 0.3)
        ctx.fillRect(col * brickW + offset + 2, row * brickH + 2, brickW - 4, brickH - 4)
      }
    }
  })
}

/** Papel pintado a rayas verticales, para paredes. */
export function stripeTexture(base: string): THREE.CanvasTexture {
  return makeTexture(`stripes-${base}`, 256, (ctx, size) => {
    ctx.fillStyle = shade(base, 1.12)
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = base
    const stripes = 4
    const width = size / (stripes * 2)
    for (let i = 0; i < stripes; i++) {
      ctx.fillRect(i * width * 2, 0, width, size)
    }
  })
}

/** Microcemento: manchas suaves sobre el color base. */
export function concreteTexture(base: string): THREE.CanvasTexture {
  return makeTexture(`concrete-${base}`, 256, (ctx, size) => {
    const rand = noise(67)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    for (let i = 0; i < 90; i++) {
      ctx.globalAlpha = 0.05 + rand() * 0.06
      ctx.fillStyle = rand() > 0.5 ? shade(base, 1.12) : shade(base, 0.85)
      const radius = 8 + rand() * 34
      ctx.beginPath()
      ctx.arc(rand() * size, rand() * size, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  })
}
