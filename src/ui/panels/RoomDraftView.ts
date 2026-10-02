import type { Project } from '../../core/model/Project'
import type { CommandStack } from '../../app/commands/CommandStack'
import { WallDrag } from '../../app/editor/WallDrag'
import { View2D } from '../view2d/View2D'
import { WallEditTool } from '../view2d/tools/WallEditTool'
import type { Selection } from '../types'

/** El plano manipulable pertenece al borrador de creación, no a la escena abierta. */
export class RoomDraftView {
  private readonly view: View2D
  private selection: Selection | null = null
  private unsubscribe: () => void

  constructor(private readonly root: Document, private project: Project, private readonly stack: CommandStack) {
    this.view = new View2D(root.querySelector<HTMLCanvasElement>('#creation-canvas')!, project)
    this.view.setSelectionProvider(() => this.selection)
    const draft = this
    this.view.setTool(new WallEditTool({
      get project() { return draft.project },
      stack,
      selection: () => this.selection,
      select: selected => { this.selection = selected; this.refresh() },
      hint: message => { root.querySelector('#draft-hint')!.textContent = message },
    }, () => this.refresh(), () => this.view.pixelsToMeters(14)))
    this.unsubscribe = project.events.on('changed', () => this.refresh())
    root.querySelector('#draft-center')!.addEventListener('click', () => this.show())
    for (const [id, action] of [['#draft-undo', () => stack.undo()], ['#draft-redo', () => stack.redo()]] as const) {
      root.querySelector(id)!.addEventListener('click', () => {
        this.cancel()
        action()
        this.refresh()
      })
    }
    root.querySelector<HTMLInputElement>('#wall-length')!.addEventListener('change', event => {
      if (this.selection?.kind !== 'wall') return
      const wall = this.selection.wall
      const length = (event.target as HTMLInputElement).valueAsNumber
      const drag = new WallDrag(this.project, wall, 'end', wall.end, stack)
      const valid = drag.preview(wall.start.add(wall.direction().scale(length)))
      if (valid) drag.commit()
      root.querySelector('#wall-message')!.textContent = valid ? '' : 'Esa longitud no cabe en el contorno.'
      this.refresh()
    })
    window.addEventListener('resize', () => {
      if (!root.querySelector<HTMLElement>('#modal-backdrop')!.hidden) this.show()
    })
    this.refresh()
  }

  setProject(project: Project): void {
    this.cancel()
    this.unsubscribe()
    this.project = project
    this.selection = null
    this.view.setProject(project)
    this.unsubscribe = project.events.on('changed', () => this.refresh())
    this.refresh()
  }

  show(): void {
    this.view.resize()
    this.view.frameRoom()
  }

  cancel(): void { this.view.cancelTool() }

  private refresh(): void {
    const selected = this.selection
    this.root.querySelector<HTMLElement>('#wall-inspector')!.hidden = selected?.kind !== 'wall'
    if (selected?.kind === 'wall') {
      this.root.querySelector('#wall-name')!.textContent = `Pared ${this.project.floorPlan.walls.indexOf(selected.wall) + 1}`
      this.root.querySelector<HTMLInputElement>('#wall-length')!.value = String(Number(selected.wall.length().toFixed(2)))
    }
    this.root.querySelector('#room-area')!.textContent = `${this.project.floorPlan.floorPolygon()!.area().toLocaleString('es-ES', { maximumFractionDigits: 2 })} m²`
    this.root.querySelector<HTMLButtonElement>('#draft-undo')!.disabled = !this.stack.canUndo()
    this.root.querySelector<HTMLButtonElement>('#draft-redo')!.disabled = !this.stack.canRedo()
    this.view.draw()
  }
}
