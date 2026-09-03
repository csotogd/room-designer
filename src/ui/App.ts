import { Project } from '../core/model/Project'
import { FloorPlan } from '../core/model/FloorPlan'
import type { LightPoint } from '../core/model/LightPoint'
import { CommandStack } from '../app/commands/CommandStack'
import { RemoveFurnitureCommand } from '../app/commands/RemoveFurnitureCommand'
import { RotateFurnitureCommand } from '../app/commands/FurnitureCommands'
import { RemoveOpeningCommand } from '../app/commands/PlanCommands'
import { SetFloorFinishCommand, SetWallFinishCommand } from '../app/commands/FinishCommands'
import { RemoveLightCommand } from '../app/commands/LightCommands'
import { DefaultCatalog } from '../app/catalog/DefaultCatalog'
import type { FurnitureCatalog } from '../app/catalog/FurnitureCatalog'
import { deserializeProject, serializeProject } from '../app/serialization/ProjectSerializer'
import { LocalStorageProjectRepository } from '../app/persistence/LocalStorageProjectRepository'
import type { ProjectRepository } from '../app/persistence/ProjectRepository'
import { fitsInRoom } from '../app/editor/RoomBounds'
import type { Furniture } from '../core/model/Furniture'
import { View3D, type Placement, type Selectable } from './view3d/View3D'
import { View2D } from './view2d/View2D'
import { WallTool } from './view2d/tools/WallTool'
import { SelectTool } from './view2d/tools/SelectTool'
import { CatalogPanel } from './panels/CatalogPanel'
import { CartPanel } from './panels/CartPanel'
import { CreateRoomModal } from './panels/CreateRoomModal'
import type { ToolContext } from './types'

/** Orquestador de la experiencia 3D-first: topbar, catálogo, escena e inspector. */
export class App {
  private project: Project
  private readonly stack = new CommandStack()
  private readonly catalog: FurnitureCatalog
  private readonly view3d: View3D
  private view2d: View2D | null = null
  private readonly catalogPanel: CatalogPanel
  private readonly cartPanel: CartPanel
  private readonly modal: CreateRoomModal
  private readonly repository: ProjectRepository = new LocalStorageProjectRepository(localStorage)
  private selection: Selectable | null = null
  private hintTimer: number | undefined
  private unsubscribe: () => void

  constructor(
    private readonly root: Document,
    catalog: FurnitureCatalog = new DefaultCatalog(),
  ) {
    this.catalog = catalog
    this.project = new Project(FloorPlan.rectangle(4.5, 3.5))
    this.unsubscribe = this.subscribeProject()

    this.view3d = new View3D(this.el('#container3d'), this.project, {
      stack: this.stack,
      onSelectionChange: (selection) => {
        this.selection = selection
        this.renderInspector()
      },
      onPlacementDone: () => this.catalogPanel.clearActive(),
      onHint: (message) => this.hint(message),
    })

    this.catalogPanel = new CatalogPanel(
      root,
      this.catalog,
      (placement) => this.startPlacement(placement),
      {
        wall: () => this.project.wallFinish,
        floor: () => this.project.floorFinish,
        setWall: (finish) => this.stack.execute(new SetWallFinishCommand(this.project, finish)),
        setFloor: (finish) => this.stack.execute(new SetFloorFinishCommand(this.project, finish)),
      },
    )
    this.cartPanel = new CartPanel(root, this.project)
    this.modal = new CreateRoomModal(root, (plan) => {
      this.setProject(new Project(plan, plan.walls[0]?.height ?? 2.5))
      this.hint('Elige puertas, ventanas, muebles o luces del catálogo y colócalos en la escena.')
    })

    this.bindTopbar()
    this.bindKeyboard()
    this.bindPlanOverlay()
    window.addEventListener('resize', () => this.onResize())
    this.onResize()
    this.refreshUndoButtons()
    this.modal.show()
  }

  /** Instantánea del estado para QA automatizado (no usar en producción). */
  debugState(): unknown {
    return serializeProject(this.project)
  }

  // ── Colocación ───────────────────────────────────────────────────────────

  private startPlacement(placement: Placement): void {
    this.view3d.setPlacement(placement)
    const names = {
      furniture: 'Mueve el ratón por la escena y haz clic para colocar',
      opening: 'Pasa el ratón por una pared y haz clic para colocar',
      light: 'Haz clic donde quieras la luz',
    }
    this.hint(`${names[placement.type]} · Esc para cancelar`)
  }

  // ── Inspector contextual ─────────────────────────────────────────────────

  private renderInspector(): void {
    const panel = this.el('#inspector')
    panel.innerHTML = ''
    if (!this.selection) {
      panel.hidden = true
      return
    }
    panel.hidden = false

    if (this.selection.type === 'furniture') {
      const furniture = this.selection.furniture
      const name = this.objName(furniture.item.name)
      name.title = furniture.item.description
      const price = this.root.createElement('span')
      price.textContent = furniture.item.price.toLocaleString('es-ES', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      })
      price.style.color = '#767676'
      panel.append(name, price)
      panel.append(
        this.pill('⟳ Rotar (R)', () => this.rotateSelection(furniture)),
        this.pill('Eliminar', () => {
          this.stack.execute(new RemoveFurnitureCommand(this.project, furniture))
          this.view3dSelect(null)
        }, 'danger'),
      )
    } else if (this.selection.type === 'opening') {
      const { wall, opening } = this.selection
      panel.append(this.objName(opening.kind === 'door' ? 'Puerta' : 'Ventana'))
      const tip = this.root.createElement('span')
      tip.textContent = 'Arrástrala por la pared'
      tip.style.color = '#767676'
      tip.style.fontSize = '12px'
      panel.append(
        tip,
        this.pill('Eliminar', () => {
          this.stack.execute(new RemoveOpeningCommand(this.project, wall, opening))
          this.view3dSelect(null)
        }, 'danger'),
      )
    } else {
      this.renderLightInspector(panel, this.selection.light)
    }
  }

  private renderLightInspector(panel: HTMLElement, light: LightPoint): void {
    const names = { ceiling: 'Plafón', wall: 'Aplique', floor: 'Lámpara de pie' }
    panel.append(this.objName(names[light.kind]))

    const onLabel = this.root.createElement('label')
    const onInput = this.root.createElement('input')
    onInput.type = 'checkbox'
    onInput.checked = light.on
    onInput.addEventListener('change', () => this.project.toggleLight(light))
    onLabel.append(onInput, 'Encendida')

    const intensityLabel = this.root.createElement('label')
    intensityLabel.append('Intensidad', this.slider(0, 1, 0.05, light.intensity, (v) =>
      this.project.updateLight(light, (l) => l.setIntensity(v)),
    ))
    const temperatureLabel = this.root.createElement('label')
    temperatureLabel.append('Color', this.slider(2000, 6500, 100, light.temperatureK, (v) =>
      this.project.updateLight(light, (l) => l.setTemperature(v)),
    ))

    panel.append(
      onLabel,
      intensityLabel,
      temperatureLabel,
      this.pill('Eliminar', () => {
        this.stack.execute(new RemoveLightCommand(this.project, light))
        this.view3dSelect(null)
      }, 'danger'),
    )
  }

  private view3dSelect(selection: Selectable | null): void {
    this.selection = selection
    this.renderInspector()
    this.view3d.setPlacement(null)
  }

  // ── Topbar ───────────────────────────────────────────────────────────────

  private bindTopbar(): void {
    this.el<HTMLButtonElement>('#undo').addEventListener('click', () => this.undo())
    this.el<HTMLButtonElement>('#redo').addEventListener('click', () => this.redo())
    this.el<HTMLButtonElement>('#save').addEventListener('click', () => this.save())
    this.el<HTMLButtonElement>('#load').addEventListener('click', () => this.load())
    this.el<HTMLButtonElement>('#new-room').addEventListener('click', () => this.modal.show())
    this.el<HTMLButtonElement>('#modal-load').addEventListener('click', () => {
      this.modal.hide()
      this.load()
    })

    const slider = this.el<HTMLInputElement>('#time-slider')
    slider.addEventListener('input', () => {
      this.project.setTimeOfDay(Number(slider.value))
      this.refreshTimeLabel()
    })

    // Panel de catálogo: minimizar a un asa lateral y alternar ancho.
    const catalog = this.el<HTMLElement>('#catalog')
    const reopen = this.el<HTMLButtonElement>('#catalog-reopen')
    this.el<HTMLButtonElement>('#catalog-collapse').addEventListener('click', () => {
      catalog.classList.add('collapsed')
      reopen.hidden = false
    })
    reopen.addEventListener('click', () => {
      catalog.classList.remove('collapsed')
      reopen.hidden = true
    })
    this.el<HTMLButtonElement>('#catalog-width').addEventListener('click', () => {
      catalog.classList.toggle('wide')
    })
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        this.undo()
      } else if ((meta && e.key.toLowerCase() === 'y') || (meta && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault()
        this.redo()
      } else if (e.key === 'r' || e.key === 'R') {
        if (this.selection?.type === 'furniture') this.rotateSelection(this.selection.furniture)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelection()
      } else if (e.key === 'Escape') {
        this.view3d.setPlacement(null)
        this.catalogPanel.clearActive()
        this.view3dSelect(null)
      }
    })
  }

  /** Rota 15° si el mueble sigue cabiendo dentro de la habitación. */
  private rotateSelection(furniture: Furniture): void {
    const target = furniture.rotationY + Math.PI / 12
    const { x, z } = furniture.position
    if (!fitsInRoom(this.project.floorPlan, furniture.item, x, z, target)) {
      this.hint('No se puede rotar ahí: chocaría con la pared.')
      return
    }
    this.stack.execute(new RotateFurnitureCommand(this.project, furniture, target))
  }

  private deleteSelection(): void {
    if (!this.selection) return
    if (this.selection.type === 'furniture') {
      this.stack.execute(new RemoveFurnitureCommand(this.project, this.selection.furniture))
    } else if (this.selection.type === 'opening') {
      this.stack.execute(
        new RemoveOpeningCommand(this.project, this.selection.wall, this.selection.opening),
      )
    } else {
      this.stack.execute(new RemoveLightCommand(this.project, this.selection.light))
    }
    this.view3dSelect(null)
  }

  private undo(): void {
    this.stack.undo()
    this.view3dSelect(null)
  }

  private redo(): void {
    this.stack.redo()
    this.view3dSelect(null)
  }

  // ── Plano 2D (overlay) ───────────────────────────────────────────────────

  private bindPlanOverlay(): void {
    const overlay = this.el('#plan-overlay')
    this.el<HTMLButtonElement>('#plan-toggle').addEventListener('click', () => {
      overlay.hidden = !overlay.hidden
      if (!overlay.hidden) {
        this.ensureView2D()
        this.view2d!.resize()
      }
    })
    this.el<HTMLButtonElement>('#plan-close').addEventListener('click', () => {
      overlay.hidden = true
    })
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-plantool]')) {
      button.addEventListener('click', () => {
        this.ensureView2D()
        const ctx = this.toolContext()
        this.view2d!.setTool(
          button.dataset.plantool === 'wall' ? new WallTool(ctx) : new SelectTool(ctx),
        )
        for (const b of this.root.querySelectorAll('[data-plantool]')) {
          b.classList.toggle('active', b === button)
        }
      })
    }
  }

  private ensureView2D(): void {
    if (this.view2d) return
    this.view2d = new View2D(this.el<HTMLCanvasElement>('#canvas2d'), this.project)
    this.view2d.setTool(new SelectTool(this.toolContext()))
  }

  private toolContext(): ToolContext {
    return {
      project: this.project,
      stack: this.stack,
      catalog: this.catalog,
      catalogItemId: () => 'sofa',
      lightKind: () => 'ceiling',
      selection: () => null,
      select: () => {},
      hint: (m) => this.hint(m),
      requestDraw: () => this.view2d?.draw(),
    }
  }

  // ── Persistencia ─────────────────────────────────────────────────────────

  private save(): void {
    void this.repository
      .save(serializeProject(this.project))
      .then(() => this.hint('Proyecto guardado en este navegador.'))
      .catch((error: Error) => this.hint(`No se pudo guardar: ${error.message}`))
  }

  private load(): void {
    void this.repository
      .load()
      .then((doc) => {
        if (!doc) {
          this.hint('No hay ningún proyecto guardado todavía.')
          return
        }
        this.setProject(deserializeProject(doc, this.catalog))
        this.modal.hide()
        this.hint('Proyecto cargado.')
      })
      .catch((error: Error) => this.hint(`No se pudo cargar: ${error.message}`))
  }

  private setProject(project: Project): void {
    this.unsubscribe()
    this.project = project
    this.unsubscribe = this.subscribeProject()
    this.view3dSelect(null)
    this.view3d.setProject(project)
    this.view2d?.setProject(project)
    this.cartPanel.setProject(project)
    this.el<HTMLInputElement>('#time-slider').value = String(project.timeOfDay)
    this.refreshTimeLabel()
    this.refreshUndoButtons()
  }

  // ── Utilidades ───────────────────────────────────────────────────────────

  private subscribeProject(): () => void {
    return this.project.events.on('changed', () => {
      this.refreshUndoButtons()
      this.cartPanel?.refresh()
    })
  }

  private refreshTimeLabel(): void {
    const hours = this.project.timeOfDay
    const hh = String(Math.floor(hours)).padStart(2, '0')
    const mm = String(Math.round((hours % 1) * 60)).padStart(2, '0')
    this.el('#time-value').textContent = `${hh}:${mm}`
  }

  private refreshUndoButtons(): void {
    this.el<HTMLButtonElement>('#undo').disabled = !this.stack.canUndo()
    this.el<HTMLButtonElement>('#redo').disabled = !this.stack.canRedo()
  }

  private onResize(): void {
    this.view3d.resize()
    this.view2d?.resize()
  }

  private hint(message: string): void {
    const el = this.el('#hint')
    el.textContent = message
    window.clearTimeout(this.hintTimer)
    this.hintTimer = window.setTimeout(() => {
      el.textContent = ''
    }, 4500)
  }

  private objName(text: string): HTMLElement {
    const span = this.root.createElement('span')
    span.className = 'obj-name'
    span.textContent = text
    return span
  }

  private pill(text: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
    const button = this.root.createElement('button')
    button.className = `pill ${extraClass}`.trim()
    button.textContent = text
    button.addEventListener('click', onClick)
    return button
  }

  private slider(
    min: number,
    max: number,
    step: number,
    value: number,
    onInput: (v: number) => void,
  ): HTMLInputElement {
    const input = this.root.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    input.addEventListener('input', () => onInput(Number(input.value)))
    return input
  }

  private el<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector)
    if (!element) throw new Error(`Elemento no encontrado: ${selector}`)
    return element
  }
}
