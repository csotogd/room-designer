import type { FloorPlan } from '../../core/model/FloorPlan'
import { Project } from '../../core/model/Project'
import type { Opening } from '../../core/model/Opening'
import type { Wall } from '../../core/model/Wall'
import { Point2D } from '../../core/geometry/Point2D'
import { addWizardOpening } from '../../app/editor/RoomWizard'
import { createRoomPlan, type RoomDimensions, type RoomShape } from '../../app/editor/RoomShapes'
import { CommandStack } from '../../app/commands/CommandStack'
import { OpeningWidthControl } from './OpeningWidthControl'
import { RoomDraftView } from './RoomDraftView'
import { AddOpeningCommand, RemoveOpeningCommand } from '../../app/commands/PlanCommands'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Asistente de creación en dos pasos:
 * 1) forma y medidas; 2) puertas y ventanas sobre el plano en planta.
 */
export class CreateRoomModal {
  private shape: RoomShape = 'rect'
  private openingKind: 'door' | 'window' = 'door'
  private plan: FloorPlan | null = null
  private previousFocus: HTMLElement | null = null
  private draftView: RoomDraftView | null = null
  private project: Project | null = null
  private readonly stack = new CommandStack()
  private selected: { wall: Wall; opening: Opening } | null = null
  private widthControl: OpeningWidthControl | null = null
  private unsubscribe: (() => void) | null = null
  private resizePointer: number | null = null

  constructor(
    private readonly root: Document,
    private readonly onCreate: (plan: FloorPlan) => void,
  ) {
    for (const card of root.querySelectorAll<HTMLButtonElement>('.shape-card')) {
      card.addEventListener('click', () => {
        this.shape = card.dataset.shape as RoomShape
        for (const c of root.querySelectorAll('.shape-card')) {
          c.classList.toggle('active', c === card)
          c.setAttribute('aria-pressed', String(c === card))
        }
        for (const field of root.querySelectorAll<HTMLElement>('.cut-only')) {
          field.hidden = this.shape === 'rect'
        }
        root.querySelector('#cut-width-label')!.textContent = this.shape === 't' ? 'Tramo central ancho' : 'Recorte ancho'
        root.querySelector('#cut-depth-label')!.textContent = this.shape === 't' ? 'Tramo central fondo' : 'Recorte fondo'
        this.refreshPreview()
      })
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-size]')) {
      button.addEventListener('click', () => {
        root.querySelector<HTMLInputElement>('#dim-w')!.value = button.dataset.width!
        root.querySelector<HTMLInputElement>('#dim-d')!.value = button.dataset.depth!
        this.refreshPreview()
      })
    }
    for (const input of root.querySelectorAll<HTMLInputElement>('.dim-grid input')) {
      input.addEventListener('input', () => this.refreshPreview())
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('#opening-toggle button')) {
      button.addEventListener('click', () => {
        this.openingKind = button.dataset.opening as 'door' | 'window'
        for (const b of root.querySelectorAll('#opening-toggle button')) {
          b.classList.toggle('active', b === button)
          b.setAttribute('aria-pressed', String(b === button))
        }
      })
    }
    root.querySelector('#wizard-next')!.addEventListener('click', () => this.toStep2())
    root.querySelector('#wizard-back')!.addEventListener('click', () => {
      this.widthControl?.commit()
      this.showStep(1)
      this.draftView?.show()
    })
    root.querySelector('#create-room')!.addEventListener('click', () => this.create())
    root.querySelector('#modal-close')?.addEventListener('click', () => this.hide())
    this.bindResizeHandle()
    root.querySelector('#create-modal')?.addEventListener('keydown', (event) => {
      const e = event as KeyboardEvent
      if (e.key === 'Escape') {
        e.stopPropagation()
        this.hide()
      }
      if (e.key !== 'Tab') return
      const controls = [...root.querySelectorAll<HTMLElement>('#create-modal button, #create-modal input, #create-modal summary, #create-modal canvas')]
        .filter(el => !el.closest('[hidden]') && (!el.closest('details:not([open])') || el.tagName === 'SUMMARY') && !el.hasAttribute('disabled'))
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (e.shiftKey && root.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && root.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    })
  }

  show(): void {
    this.previousFocus = this.root.activeElement as HTMLElement | null
    this.root.querySelector<HTMLElement>('#modal-backdrop')!.hidden = false
    this.setWorkspaceInert(true)
    this.showStep(1)
    if (!this.plan) this.refreshPreview()
    else this.draftView?.show()
  }

  hide(): void {
    this.draftView?.cancel()
    this.widthControl?.commit()
    this.root.querySelector<HTMLElement>('#modal-backdrop')!.hidden = true
    this.setWorkspaceInert(false)
    if (this.previousFocus?.isConnected && !this.previousFocus.closest('[hidden], [inert]')) {
      this.previousFocus.focus()
    } else this.root.querySelector<HTMLElement>('#new-room')?.focus()
  }

  private setWorkspaceInert(inert: boolean): void {
    for (const element of this.root.querySelectorAll<HTMLElement>('#topbar, #stage')) element.inert = inert
  }

  private showStep(step: 1 | 2): void {
    this.root.querySelector<HTMLElement>('#wizard-step-1')!.hidden = step !== 1
    this.root.querySelector<HTMLElement>('#wizard-step-2')!.hidden = step !== 2
    this.root.querySelector('#create-modal')?.setAttribute('aria-labelledby', `wizard-title-${step}`)
    this.root.querySelector('#create-modal')?.setAttribute('data-step', String(step))
    this.root.querySelector<HTMLElement>(step === 1 ? '.shape-card.active' : '#opening-toggle .active')?.focus()
  }

  private value(id: string): number {
    return Number(this.root.querySelector<HTMLInputElement>(id)!.value)
  }

  private dimensions(): RoomDimensions {
    return { shape: this.shape, width: this.value('#dim-w'), depth: this.value('#dim-d'),
      height: this.value('#dim-h'), cutWidth: this.value('#dim-cw'), cutDepth: this.value('#dim-cd') }
  }

  private refreshPreview(): FloorPlan | null {
    const error = this.root.querySelector<HTMLElement>('#room-error')!
    const next = this.root.querySelector<HTMLButtonElement>('#wizard-next')!
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-size]')) {
      const active = Number(button.dataset.width) === this.value('#dim-w') && Number(button.dataset.depth) === this.value('#dim-d')
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    }
    try {
      const plan = createRoomPlan(this.dimensions())
      this.selectOpening(null)
      this.unsubscribe?.()
      this.draftView?.cancel()
      this.stack.clear()
      this.plan = plan
      this.project = new Project(plan, this.value('#dim-h'))
      if (this.draftView) this.draftView.setProject(this.project)
      else this.draftView = new RoomDraftView(this.root, this.project, this.stack)
      this.draftView.show()
      this.unsubscribe = this.project.events.on('changed', () => {
        if (!this.root.querySelector<HTMLElement>('#wizard-step-2')!.hidden) this.renderPlanSvg()
      })
      error.textContent = ''
      next.disabled = false
      return plan
    } catch (cause) {
      error.textContent = (cause as Error).message
      next.disabled = true
      this.root.querySelector('#room-area')!.textContent = '—'
      return null
    }
  }

  private toStep2(): void {
    if (!this.plan) return
    this.root.querySelector('#opening-error')!.textContent = ''
    this.showStep(2)
    this.renderPlanSvg()
  }

  private create(): void {
    if (!this.plan) return
    this.hide()
    this.onCreate(this.plan)
    this.selectOpening(null)
    this.unsubscribe?.()
    this.unsubscribe = null
    this.plan = null
  }

  // ── Mini-plano SVG del paso 2 ────────────────────────────────────────────

  private renderPlanSvg(): void {
    const plan = this.plan!
    const container = this.root.querySelector<HTMLElement>('#wizard-plan')!
    container.innerHTML = ''

    const xs = plan.walls.flatMap((w) => [w.start.x, w.end.x])
    const ys = plan.walls.flatMap((w) => [w.start.y, w.end.y])
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const pad = 0.8
    const svg = this.root.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`)
    svg.setAttribute('id', 'wizard-plan-svg')

    const polygon = plan.floorPolygon()
    if (polygon) {
      const floor = this.root.createElementNS(SVG_NS, 'polygon')
      floor.setAttribute(
        'points',
        polygon.vertices.map((v) => `${v.x},${v.y}`).join(' '),
      )
      floor.setAttribute('fill', '#f8f7f4')
      svg.append(floor)
    }

    // Centroide de la planta: orienta los símbolos hacia el interior.
    const cx = xs.reduce((s, v) => s + v, 0) / xs.length
    const cy = ys.reduce((s, v) => s + v, 0) / ys.length

    for (const wall of plan.walls) {
      const line = this.root.createElementNS(SVG_NS, 'line')
      line.setAttribute('x1', String(wall.start.x))
      line.setAttribute('y1', String(wall.start.y))
      line.setAttribute('x2', String(wall.end.x))
      line.setAttribute('y2', String(wall.end.y))
      line.setAttribute('stroke', '#191919')
      line.setAttribute('stroke-width', '0.16')
      line.setAttribute('stroke-linecap', 'square')
      svg.append(line)

      // Zona de clic generosa; las aperturas quedan encima para seleccionarlas.
      const hit = this.root.createElementNS(SVG_NS, 'line')
      hit.setAttribute('x1', String(wall.start.x))
      hit.setAttribute('y1', String(wall.start.y))
      hit.setAttribute('x2', String(wall.end.x))
      hit.setAttribute('y2', String(wall.end.y))
      hit.setAttribute('stroke', 'transparent')
      hit.setAttribute('stroke-width', '0.6')
      hit.classList.add('wizard-wall')
      hit.addEventListener('click', (e) => this.onWallClick(wall, svg, e))
      svg.append(hit)

      for (const opening of wall.openings) this.drawOpening(svg, wall, opening, cx, cy)
    }

    this.dimLabel(svg, (minX + maxX) / 2, maxY + 0.52, this.metros(maxX - minX))
    this.dimLabel(svg, minX - 0.5, (minY + maxY) / 2, this.metros(maxY - minY), -90)
    container.append(svg)
  }

  private metros(value: number): string {
    return `${value.toLocaleString('es-ES', { maximumFractionDigits: 1 })} m`
  }

  private dimLabel(svg: SVGElement, x: number, y: number, text: string, rotate = 0): void {
    const label = this.root.createElementNS(SVG_NS, 'text')
    label.setAttribute('x', String(x))
    label.setAttribute('y', String(y))
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('fill', '#747474')
    label.setAttribute('font-size', '0.28')
    label.setAttribute('font-weight', '600')
    label.setAttribute('letter-spacing', '0.02')
    if (rotate) label.setAttribute('transform', `rotate(${rotate} ${x} ${y})`)
    label.textContent = text
    svg.append(label)
  }

  /** Símbolos de arquitecto: arco de batiente para puertas, marco doble para ventanas. */
  private drawOpening(svg: SVGElement, wall: Wall, opening: Opening, cx: number, cy: number): void {
    const segment = wall.segment()
    const a = segment.pointAtDistance(opening.offset)
    const b = segment.pointAtDistance(opening.end)
    const w = opening.end - opening.offset
    const dx = (b.x - a.x) / w
    const dy = (b.y - a.y) / w
    let nx = -dy
    let ny = dx
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    if ((cx - mx) * nx + (cy - my) * ny < 0) {
      nx = -nx
      ny = -ny
    }

    // Hueco en el muro.
    const gap = this.root.createElementNS(SVG_NS, 'line')
    gap.setAttribute('x1', String(a.x))
    gap.setAttribute('y1', String(a.y))
    gap.setAttribute('x2', String(b.x))
    gap.setAttribute('y2', String(b.y))
    gap.setAttribute('stroke', '#f8f7f4')
    gap.setAttribute('stroke-width', '0.2')
    svg.append(gap)

    if (opening.kind === 'door') {
      const ex = a.x + nx * w
      const ey = a.y + ny * w
      const sweep = dx * ny - dy * nx > 0 ? 1 : 0

      const wedge = this.root.createElementNS(SVG_NS, 'path')
      wedge.setAttribute(
        'd',
        `M ${a.x} ${a.y} L ${b.x} ${b.y} A ${w} ${w} 0 0 ${sweep} ${ex} ${ey} Z`,
      )
      wedge.setAttribute('fill', 'rgba(25, 25, 25, 0.06)')
      svg.append(wedge)

      const arc = this.root.createElementNS(SVG_NS, 'path')
      arc.setAttribute('d', `M ${b.x} ${b.y} A ${w} ${w} 0 0 ${sweep} ${ex} ${ey}`)
      arc.setAttribute('fill', 'none')
      arc.setAttribute('stroke', '#191919')
      arc.setAttribute('stroke-width', '0.035')
      arc.setAttribute('stroke-dasharray', '0.09 0.07')
      svg.append(arc)

      const leaf = this.root.createElementNS(SVG_NS, 'line')
      leaf.setAttribute('x1', String(a.x))
      leaf.setAttribute('y1', String(a.y))
      leaf.setAttribute('x2', String(ex))
      leaf.setAttribute('y2', String(ey))
      leaf.setAttribute('stroke', '#191919')
      leaf.setAttribute('stroke-width', '0.07')
      leaf.setAttribute('stroke-linecap', 'round')
      svg.append(leaf)
    } else {
      for (const offset of [-0.05, 0.05]) {
        const frame = this.root.createElementNS(SVG_NS, 'line')
        frame.setAttribute('x1', String(a.x + nx * offset))
        frame.setAttribute('y1', String(a.y + ny * offset))
        frame.setAttribute('x2', String(b.x + nx * offset))
        frame.setAttribute('y2', String(b.y + ny * offset))
        frame.setAttribute('stroke', '#6b827d')
        frame.setAttribute('stroke-width', '0.045')
        svg.append(frame)
      }
    }

    // Zona de clic para seleccionar la apertura sin borrarla.
    const hit = this.root.createElementNS(SVG_NS, 'line')
    hit.setAttribute('x1', String(a.x))
    hit.setAttribute('y1', String(a.y))
    hit.setAttribute('x2', String(b.x))
    hit.setAttribute('y2', String(b.y))
    hit.setAttribute('stroke', 'transparent')
    hit.setAttribute('stroke-width', '0.5')
    hit.classList.add('wizard-opening')
    hit.setAttribute('tabindex', '0')
    hit.setAttribute('role', 'button')
    hit.setAttribute('aria-label', `${opening.kind === 'door' ? 'Puerta' : 'Ventana'} de ${this.metros(opening.width)}; editar ancho`)
    hit.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.selectOpening({ wall, opening })
        this.root.querySelector<HTMLInputElement>('#wizard-opening-editor input')?.focus()
      }
    })
    hit.addEventListener('click', (e) => {
      e.stopPropagation()
      this.selectOpening({ wall, opening })
    })
    svg.append(hit)
    if (this.selected?.opening === opening) {
      this.dimLabel(svg, mx + nx * 0.4, my + ny * 0.4, this.metros(opening.width))
      const handle = this.root.createElementNS(SVG_NS, 'circle')
      handle.setAttribute('cx', String(b.x))
      handle.setAttribute('cy', String(b.y))
      handle.setAttribute('r', '0.14')
      handle.classList.add('opening-resize-handle')
      const title = this.root.createElementNS(SVG_NS, 'title')
      title.textContent = 'Arrastra para cambiar el ancho'
      handle.append(title)
      svg.append(handle)
    }
  }

  private onWallClick(wall: Wall, svg: SVGElement, event: MouseEvent): void {
    const point = this.svgPoint(svg as SVGSVGElement, event)
    const along = wall.segment().projectDistance(point)
    const index = this.plan!.walls.indexOf(wall)
    const opening = addWizardOpening(this.plan!, index, this.openingKind, along)
    this.root.querySelector('#opening-error')!.textContent = opening ? '' : 'No cabe aquí. Prueba en un tramo libre de la pared.'
    if (opening) {
      wall.removeOpening(opening)
      this.stack.execute(new AddOpeningCommand(this.project!, wall, opening))
      this.selectOpening({ wall, opening })
    }
  }

  private svgPoint(svg: SVGSVGElement, event: MouseEvent): Point2D {
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const local = point.matrixTransform(svg.getScreenCTM()!.inverse())
    return new Point2D(local.x, local.y)
  }

  private selectOpening(selection: { wall: Wall; opening: Opening } | null): void {
    this.widthControl?.dispose()
    this.widthControl = null
    this.selected = selection
    const editor = this.root.querySelector<HTMLElement>('#wizard-opening-editor')!
    editor.replaceChildren()
    editor.hidden = !selection
    if (selection) {
      const { wall, opening } = selection
      const name = this.root.createElement('strong')
      name.textContent = opening.kind === 'door' ? 'Puerta seleccionada' : 'Ventana seleccionada'
      this.widthControl = new OpeningWidthControl(this.root, this.project!, wall, opening, this.stack)
      const remove = this.root.createElement('button')
      remove.className = 'link-btn'
      remove.textContent = 'Eliminar apertura'
      remove.addEventListener('click', () => {
        this.selectOpening(null)
        this.stack.execute(new RemoveOpeningCommand(this.project!, wall, opening))
      })
      editor.append(name, this.widthControl.element, remove)
    }
    if (this.plan) this.renderPlanSvg()
  }

  private bindResizeHandle(): void {
    const container = this.root.querySelector<HTMLElement>('#wizard-plan')!
    container.addEventListener('pointerdown', event => {
      if (!(event.target as Element).closest('.opening-resize-handle')) return
      event.preventDefault()
      this.resizePointer = event.pointerId
      container.setPointerCapture(event.pointerId)
    })
    container.addEventListener('pointermove', event => {
      if (this.resizePointer !== event.pointerId || !this.selected) return
      const svg = container.querySelector('svg')!
      const point = this.svgPoint(svg, event)
      const { wall, opening } = this.selected
      this.widthControl?.preview(wall.segment().projectDistance(point) - opening.offset)
    })
    container.addEventListener('pointerup', event => {
      if (this.resizePointer !== event.pointerId) return
      this.resizePointer = null
      this.widthControl?.commit()
      container.releasePointerCapture(event.pointerId)
    })
    container.addEventListener('pointercancel', () => {
      this.resizePointer = null
      this.widthControl?.cancel()
    })
  }
}
