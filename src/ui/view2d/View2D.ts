import { Point2D } from '../../core/geometry/Point2D'
import type { Project } from '../../core/model/Project'
import type { Selection, Tool2D } from '../types'

const GRID_STEP = 0.5
const WALL_COLOR = '#3a3a3a'
const SELECTED = '#0058a3'

/**
 * Vista 2D del plano sobre canvas. Convierte eventos de puntero a coordenadas
 * de mundo, delega en la herramienta activa y redibuja al cambiar el dominio.
 */
export class View2D {
  private readonly ctx: CanvasRenderingContext2D
  private scale = 80
  private offsetX = 120
  private offsetY = 100
  private tool: Tool2D | null = null
  private getSelection: () => Selection | null = () => null
  private panning = false
  private lastPointer: [number, number] = [0, 0]
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private project: Project,
  ) {
    this.ctx = canvas.getContext('2d')!
    this.subscribe()
    this.bindEvents()
  }

  setProject(project: Project): void {
    this.unsubscribe?.()
    this.project = project
    this.subscribe()
    this.draw()
  }

  setTool(tool: Tool2D | null): void {
    this.tool?.cancel()
    this.tool = tool
    this.draw()
  }

  setSelectionProvider(provider: () => Selection | null): void {
    this.getSelection = provider
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1
    const { clientWidth, clientHeight } = this.canvas
    this.canvas.width = clientWidth * dpr
    this.canvas.height = clientHeight * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.draw()
  }

  toWorld(clientX: number, clientY: number): Point2D {
    const rect = this.canvas.getBoundingClientRect()
    return new Point2D(
      (clientX - rect.left - this.offsetX) / this.scale,
      (clientY - rect.top - this.offsetY) / this.scale,
    )
  }

  toScreen = (p: Point2D): [number, number] => [
    p.x * this.scale + this.offsetX,
    p.y * this.scale + this.offsetY,
  ]

  // ── Dibujo ───────────────────────────────────────────────────────────────

  draw(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas
    const ctx = this.ctx
    ctx.clearRect(0, 0, w, h)
    this.drawGrid(w, h)
    this.drawFloor()
    for (const wall of this.project.floorPlan.walls) this.drawWall(wall)
    this.drawFurniture()
    this.drawLights()
    this.tool?.drawOverlay(ctx, this.toScreen, this.scale)
  }

  private drawGrid(w: number, h: number): void {
    const ctx = this.ctx
    const step = GRID_STEP * this.scale
    ctx.lineWidth = 1
    for (let x = this.offsetX % step; x < w; x += step) {
      const isMeter = Math.round((x - this.offsetX) / this.scale) === (x - this.offsetX) / this.scale
      ctx.strokeStyle = isMeter ? '#ddd6ca' : '#eae5db'
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    for (let y = this.offsetY % step; y < h; y += step) {
      const isMeter = Math.round((y - this.offsetY) / this.scale) === (y - this.offsetY) / this.scale
      ctx.strokeStyle = isMeter ? '#ddd6ca' : '#eae5db'
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
  }

  private drawFloor(): void {
    const polygon = this.project.floorPlan.floorPolygon()
    if (!polygon) return
    const ctx = this.ctx
    ctx.beginPath()
    polygon.vertices.forEach((v, i) => {
      const [x, y] = this.toScreen(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fillStyle = '#efe9dd'
    ctx.fill()
  }

  private drawWall(wall: import('../../core/model/Wall').Wall): void {
    const ctx = this.ctx
    const selection = this.getSelection()
    const isSelected = selection?.kind === 'wall' && selection.wall === wall
    const [x1, y1] = this.toScreen(wall.start)
    const [x2, y2] = this.toScreen(wall.end)
    ctx.strokeStyle = isSelected ? SELECTED : WALL_COLOR
    ctx.lineWidth = Math.max(wall.thickness * this.scale, 5)
    ctx.lineCap = 'butt'
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()

    for (const opening of wall.openings) {
      const segment = wall.segment()
      const a = this.toScreen(segment.pointAtDistance(opening.offset))
      const b = this.toScreen(segment.pointAtDistance(opening.end))
      ctx.strokeStyle = '#f4f1ec'
      ctx.lineWidth = Math.max(wall.thickness * this.scale, 5) + 2
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()

      if (opening.kind === 'window') {
        ctx.strokeStyle = '#5a8bb0'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(a[0], a[1])
        ctx.lineTo(b[0], b[1])
        ctx.stroke()
      } else {
        const center = this.toScreen(wall.worldCenterOf(opening))
        ctx.strokeStyle = '#b08968'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(center[0], center[1], (opening.width / 2) * this.scale, 0, Math.PI)
        ctx.stroke()
      }
    }
  }

  private drawFurniture(): void {
    const ctx = this.ctx
    const selection = this.getSelection()
    const sorted = [...this.project.furniture].sort((a, b) => a.position.y - b.position.y)
    for (const f of sorted) {
      const isSelected = selection?.kind === 'furniture' && selection.furniture === f
      const [cx, cy] = this.toScreen(new Point2D(f.position.x, f.position.z))
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(f.rotationY)
      const w = f.item.width * this.scale
      const d = f.item.depth * this.scale
      ctx.fillStyle = f.item.color + 'cc'
      ctx.strokeStyle = isSelected ? SELECTED : '#00000033'
      ctx.lineWidth = isSelected ? 3 : 1
      ctx.fillRect(-w / 2, -d / 2, w, d)
      ctx.strokeRect(-w / 2, -d / 2, w, d)
      ctx.rotate(-f.rotationY)
      ctx.fillStyle = '#2b2b2b'
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(f.item.name, 0, 4)
      ctx.restore()
    }
  }

  private drawLights(): void {
    const ctx = this.ctx
    const selection = this.getSelection()
    for (const light of this.project.lights) {
      const isSelected = selection?.kind === 'light' && selection.light === light
      const [x, y] = this.toScreen(new Point2D(light.position.x, light.position.z))
      ctx.beginPath()
      ctx.arc(x, y, 8, 0, Math.PI * 2)
      ctx.fillStyle = light.on ? '#ffd54a' : '#c9c4ba'
      ctx.fill()
      ctx.strokeStyle = isSelected ? SELECTED : '#00000055'
      ctx.lineWidth = isSelected ? 3 : 1
      ctx.stroke()
      ctx.strokeStyle = light.on ? '#e6a817' : '#a09a8e'
      ctx.lineWidth = 1.5
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4
        ctx.beginPath()
        ctx.moveTo(x + Math.cos(angle) * 10, y + Math.sin(angle) * 10)
        ctx.lineTo(x + Math.cos(angle) * 13, y + Math.sin(angle) * 13)
        ctx.stroke()
      }
    }
  }

  // ── Eventos ──────────────────────────────────────────────────────────────

  private subscribe(): void {
    this.unsubscribe = this.project.events.on('changed', () => this.draw())
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2) {
        this.panning = true
        this.lastPointer = [e.clientX, e.clientY]
        return
      }
      this.canvas.setPointerCapture(e.pointerId)
      this.tool?.onDown(this.toWorld(e.clientX, e.clientY), e)
      this.draw()
    })
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.panning) {
        this.offsetX += e.clientX - this.lastPointer[0]
        this.offsetY += e.clientY - this.lastPointer[1]
        this.lastPointer = [e.clientX, e.clientY]
        this.draw()
        return
      }
      this.tool?.onMove(this.toWorld(e.clientX, e.clientY), e)
      this.draw()
    })
    this.canvas.addEventListener('pointerup', (e) => {
      if (this.panning) {
        this.panning = false
        return
      }
      this.tool?.onUp(this.toWorld(e.clientX, e.clientY), e)
      this.draw()
    })
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const rect = this.canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      this.offsetX = px - (px - this.offsetX) * factor
      this.offsetY = py - (py - this.offsetY) * factor
      this.scale *= factor
      this.draw()
    })
  }
}
