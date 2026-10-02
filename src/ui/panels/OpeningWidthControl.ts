import type { Project } from '../../core/model/Project'
import type { Wall } from '../../core/model/Wall'
import type { Opening } from '../../core/model/Opening'
import type { CommandStack } from '../../app/commands/CommandStack'
import { OpeningResize } from '../../app/editor/OpeningResize'

/** Control compartido por el asistente y el inspector de la escena. */
export class OpeningWidthControl {
  readonly element: HTMLDivElement
  private readonly range: HTMLInputElement
  private readonly number: HTMLInputElement
  private readonly resize: OpeningResize
  private readonly unsubscribe: () => void

  constructor(
    root: Document,
    project: Project,
    private readonly wall: Wall,
    private readonly opening: Opening,
    stack: CommandStack,
    private readonly onCommit: () => void = () => {},
  ) {
    this.resize = new OpeningResize(project, wall, opening, stack)
    this.element = root.createElement('div')
    this.element.className = 'opening-width-control'
    const label = root.createElement('span')
    label.textContent = 'Ancho'
    this.range = root.createElement('input')
    this.range.type = 'range'
    this.number = root.createElement('input')
    this.number.type = 'number'
    const name = opening.kind === 'door' ? 'puerta' : 'ventana'
    this.range.setAttribute('aria-label', `Ancho de ${name}`)
    this.number.setAttribute('aria-label', `Ancho de ${name} en metros`)
    for (const input of [this.range, this.number]) {
      input.step = '0.01'
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          this.cancel()
        }
      })
    }
    this.range.addEventListener('input', () => this.preview(this.range.valueAsNumber))
    this.range.addEventListener('change', () => this.commit())
    this.range.addEventListener('pointercancel', () => this.cancel())
    this.number.addEventListener('change', () => {
      this.preview(this.number.valueAsNumber)
      this.commit()
      this.sync()
    })
    this.element.append(label, this.range, this.number, 'm')
    this.unsubscribe = project.events.on('changed', () => this.sync())
    this.sync()
  }

  preview(width: number): void { this.resize.preview(width) }
  commit(): void { this.resize.commit(); this.onCommit() }
  cancel(): void { this.resize.cancel(); this.sync() }

  dispose(): void {
    this.cancel()
    this.unsubscribe()
  }

  private sync(): void {
    const max = this.wall.maxOpeningWidth(this.opening)
    for (const input of [this.range, this.number]) {
      input.min = String(Math.min(0.3, max))
      input.max = String(max)
      input.value = String(Number(this.opening.width.toFixed(2)))
    }
    this.range.setAttribute('aria-valuetext', `${this.opening.width.toLocaleString('es-ES')} metros`)
  }
}
