import { FloorPlan } from '../../core/model/FloorPlan'
import type { Opening } from '../../core/model/Opening'
import type { Wall } from '../../core/model/Wall'
import { Point2D } from '../../core/geometry/Point2D'
import { addWizardOpening } from '../../app/editor/RoomWizard'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Asistente de creación en dos pasos:
 * 1) forma y medidas; 2) puertas y ventanas sobre el plano en planta.
 */
export class CreateRoomModal {
  private shape: 'rect' | 'l' = 'rect'
  private openingKind: 'door' | 'window' = 'door'
  private plan: FloorPlan | null = null

  constructor(
    private readonly root: Document,
    private readonly onCreate: (plan: FloorPlan) => void,
  ) {
    for (const card of root.querySelectorAll<HTMLButtonElement>('.shape-card')) {
      card.addEventListener('click', () => {
        this.shape = card.dataset.shape as 'rect' | 'l'
        for (const c of root.querySelectorAll('.shape-card')) {
          c.classList.toggle('active', c === card)
        }
        for (const field of root.querySelectorAll<HTMLElement>('.l-only')) {
          field.hidden = this.shape !== 'l'
        }
      })
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('#opening-toggle button')) {
      button.addEventListener('click', () => {
        this.openingKind = button.dataset.opening as 'door' | 'window'
        for (const b of root.querySelectorAll('#opening-toggle button')) {
          b.classList.toggle('active', b === button)
        }
      })
    }
    root.querySelector('#wizard-next')!.addEventListener('click', () => this.toStep2())
    root.querySelector('#wizard-back')!.addEventListener('click', () => this.showStep(1))
    root.querySelector('#create-room')!.addEventListener('click', () => this.create())
  }

  show(): void {
    this.root.querySelector<HTMLElement>('#modal-backdrop')!.hidden = false
    this.showStep(1)
  }

  hide(): void {
    this.root.querySelector<HTMLElement>('#modal-backdrop')!.hidden = true
  }

  private showStep(step: 1 | 2): void {
    this.root.querySelector<HTMLElement>('#wizard-step-1')!.hidden = step !== 1
    this.root.querySelector<HTMLElement>('#wizard-step-2')!.hidden = step !== 2
  }

  private value(id: string): number {
    return Number(this.root.querySelector<HTMLInputElement>(id)!.value)
  }

  private buildPlan(): FloorPlan | null {
    const width = this.value('#dim-w')
    const depth = this.value('#dim-d')
    const height = this.value('#dim-h')
    if (!(width > 0) || !(depth > 0) || !(height > 0)) return null
    return this.shape === 'l'
      ? FloorPlan.lShape(
          width,
          depth,
          Math.min(this.value('#dim-cw'), width - 0.5),
          Math.min(this.value('#dim-cd'), depth - 0.5),
          height,
        )
      : FloorPlan.rectangle(width, depth, height)
  }

  private toStep2(): void {
    const plan = this.buildPlan()
    if (!plan) return
    this.plan = plan
    this.showStep(2)
    this.renderPlanSvg()
  }

  private create(): void {
    if (!this.plan) return
    this.hide()
    this.onCreate(this.plan)
    this.plan = null
  }

  // ── Mini-plano SVG del paso 2 ────────────────────────────────────────────

  private renderPlanSvg(): void {
    const container = this.root.querySelector<HTMLElement>('#wizard-plan')!
    container.innerHTML = ''
    const plan = this.plan!

    const xs = plan.walls.flatMap((w) => [w.start.x, w.end.x])
    const ys = plan.walls.flatMap((w) => [w.start.y, w.end.y])
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    const pad = 0.5
    const svg = this.root.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${maxX + pad * 2} ${maxY + pad * 2}`)
    svg.setAttribute('id', 'wizard-plan-svg')

    const polygon = plan.floorPolygon()
    if (polygon) {
      const floor = this.root.createElementNS(SVG_NS, 'polygon')
      floor.setAttribute(
        'points',
        polygon.vertices.map((v) => `${v.x},${v.y}`).join(' '),
      )
      floor.setAttribute('fill', '#f3efe6')
      svg.append(floor)
    }

    for (const wall of plan.walls) {
      const line = this.root.createElementNS(SVG_NS, 'line')
      line.setAttribute('x1', String(wall.start.x))
      line.setAttribute('y1', String(wall.start.y))
      line.setAttribute('x2', String(wall.end.x))
      line.setAttribute('y2', String(wall.end.y))
      line.setAttribute('stroke', '#3a3a3a')
      line.setAttribute('stroke-width', '0.14')
      line.setAttribute('stroke-linecap', 'square')
      svg.append(line)

      // Zona de clic generosa e invisible sobre la pared (las aperturas van
      // encima para poder quitarlas con clic).
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

      for (const opening of wall.openings) this.drawOpening(svg, wall, opening)
    }
    container.append(svg)
  }

  private drawOpening(svg: SVGElement, wall: Wall, opening: Opening): void {
    const segment = wall.segment()
    const a = segment.pointAtDistance(opening.offset)
    const b = segment.pointAtDistance(opening.end)
    const line = this.root.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', String(a.x))
    line.setAttribute('y1', String(a.y))
    line.setAttribute('x2', String(b.x))
    line.setAttribute('y2', String(b.y))
    line.setAttribute('stroke', opening.kind === 'door' ? '#b08968' : '#5a8bb0')
    line.setAttribute('stroke-width', '0.2')
    line.classList.add('wizard-opening')
    line.addEventListener('click', (e) => {
      e.stopPropagation()
      wall.removeOpening(opening)
      this.renderPlanSvg()
    })
    svg.append(line)
  }

  private onWallClick(wall: Wall, svg: SVGElement, event: MouseEvent): void {
    const point = this.svgPoint(svg as SVGSVGElement, event)
    const along = wall.segment().projectDistance(point)
    const index = this.plan!.walls.indexOf(wall)
    addWizardOpening(this.plan!, index, this.openingKind, along)
    this.renderPlanSvg()
  }

  private svgPoint(svg: SVGSVGElement, event: MouseEvent): Point2D {
    const rect = svg.getBoundingClientRect()
    const viewBox = svg.viewBox.baseVal
    return new Point2D(
      viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width,
      viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height,
    )
  }
}
