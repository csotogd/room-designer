import type { FurnitureCatalog } from '../../app/catalog/FurnitureCatalog'
import type { FloorFinish, FloorMaterial, WallFinish, WallMaterial } from '../../core/model/Finishes'
import { productImage } from '../view3d/thumbnails'
import type { Placement } from '../view3d/View3D'

const euros = (value: number): string =>
  value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

interface SimpleEntry {
  placement: Placement
  name: string
  emoji: string
  detail: string
}

/** Acceso del panel a los acabados del proyecto (App lo cablea con comandos). */
export interface FinishControls {
  wall(): WallFinish
  floor(): FloorFinish
  setWall(finish: WallFinish): void
  setFloor(finish: FloorFinish): void
}

const WALL_MATERIALS: { id: WallMaterial; name: string }[] = [
  { id: 'paint', name: 'Pintura' },
  { id: 'stripes', name: 'Rayas' },
  { id: 'brick', name: 'Ladrillo' },
]

const FLOOR_MATERIALS: { id: FloorMaterial; name: string }[] = [
  { id: 'wood', name: 'Madera' },
  { id: 'tiles', name: 'Baldosa' },
  { id: 'carpet', name: 'Moqueta' },
  { id: 'concrete', name: 'Microcemento' },
]

const WALL_COLORS = ['#f2eee4', '#f5e9d7', '#d7d7d2', '#b9c4b1', '#a9c0d0', '#d8a48f', '#e3c0b8', '#6f7378']
const FLOOR_COLORS = ['#d9c5a3', '#a67c52', '#b1653f', '#b9b4ab', '#e8e2d8', '#55504a']

/**
 * Panel lateral de catálogo: los muebles como tarjetas de producto con foto,
 * nombre y precio (scroll largo, como en un configurador comercial); puertas,
 * ventanas y luces como tarjetas simples. Elegir una tarjeta entra en modo
 * colocación; colocar o Esc lo desactiva.
 */
export class CatalogPanel {
  private activeTab = 'furniture'
  private activeCard: HTMLElement | null = null

  constructor(
    private readonly root: Document,
    private readonly catalog: FurnitureCatalog,
    private readonly onPick: (placement: Placement) => void,
    private readonly finishes: FinishControls,
  ) {
    for (const button of root.querySelectorAll<HTMLButtonElement>('#catalog-tabs button')) {
      button.addEventListener('click', () => {
        this.activeTab = button.dataset.tab!
        for (const b of root.querySelectorAll('#catalog-tabs button')) {
          b.classList.toggle('active', b === button)
        }
        this.renderCards()
      })
    }
    this.renderCards()
  }

  clearActive(): void {
    this.activeCard?.classList.remove('active')
    this.activeCard = null
  }

  private renderCards(): void {
    const container = this.root.querySelector<HTMLElement>('#catalog-cards')!
    container.innerHTML = ''
    this.activeCard = null
    if (this.activeTab === 'furniture') this.renderProductCards(container)
    else if (this.activeTab === 'finishes') this.renderFinishes(container)
    else this.renderSimpleCards(container)
  }

  // ── Acabados de pared y suelo ────────────────────────────────────────────

  private renderFinishes(container: HTMLElement): void {
    container.append(
      this.finishSection('Pared', WALL_MATERIALS, WALL_COLORS, this.finishes.wall(), (finish) =>
        this.finishes.setWall(finish as WallFinish),
      ),
      this.finishSection('Suelo', FLOOR_MATERIALS, FLOOR_COLORS, this.finishes.floor(), (finish) =>
        this.finishes.setFloor(finish as FloorFinish),
      ),
    )
  }

  private finishSection(
    title: string,
    materials: readonly { id: string; name: string }[],
    colors: readonly string[],
    current: { material: string; color: string },
    apply: (finish: { material: string; color: string }) => void,
  ): HTMLElement {
    const section = this.root.createElement('div')
    section.className = 'finish-section'
    const heading = this.root.createElement('h4')
    heading.textContent = title
    section.append(heading)

    const applyAndRefresh = (finish: { material: string; color: string }): void => {
      apply(finish)
      this.renderCards()
    }

    const chips = this.root.createElement('div')
    chips.className = 'chips'
    for (const material of materials) {
      const chip = this.root.createElement('button')
      chip.className = 'chip'
      chip.textContent = material.name
      chip.classList.toggle('active', material.id === current.material)
      chip.addEventListener('click', () =>
        applyAndRefresh({ material: material.id, color: current.color }),
      )
      chips.append(chip)
    }
    section.append(chips)

    const swatches = this.root.createElement('div')
    swatches.className = 'swatches'
    for (const color of colors) {
      const swatch = this.root.createElement('button')
      swatch.className = 'swatch-color'
      swatch.style.background = color
      swatch.title = color
      swatch.classList.toggle('active', color.toLowerCase() === current.color.toLowerCase())
      swatch.addEventListener('click', () =>
        applyAndRefresh({ material: current.material, color }),
      )
      swatches.append(swatch)
    }
    const custom = this.root.createElement('input')
    custom.type = 'color'
    custom.value = current.color
    custom.title = 'Color personalizado'
    // Mientras se arrastra el selector solo aplicamos; al soltar, refrescamos
    // el panel (re-renderizar en caliente cerraría el picker nativo).
    custom.addEventListener('input', () =>
      apply({ material: current.material, color: custom.value }),
    )
    custom.addEventListener('change', () =>
      applyAndRefresh({ material: current.material, color: custom.value }),
    )
    swatches.append(custom)
    section.append(swatches)
    return section
  }

  // ── Tarjetas de producto (muebles) ───────────────────────────────────────

  private renderProductCards(container: HTMLElement): void {
    // El menú de muebles enseña solo productos de catálogos web (con origen);
    // los locales siguen existiendo para resolver proyectos antiguos.
    const products = this.catalog.items().filter((p) => p.origin)
    if (products.length === 0) {
      const empty = this.root.createElement('div')
      empty.style.cssText = 'grid-column:1/-1;color:#6e6a63;font-size:12.5px;line-height:1.5;padding:8px'
      empty.textContent =
        'Sin productos web todavía: ejecuta la ingesta del pipeline (npm run pipeline:ingest) y publícalos con npm run pipeline:link.'
      container.append(empty)
      return
    }
    for (const product of products) {
      // div y no button: la caja anónima interna de <button> ignora la altura
      // de la imagen al calcular el tamaño intrínseco de la fila del grid.
      const card = this.root.createElement('div')
      card.className = 'card product'
      card.setAttribute('role', 'button')
      card.tabIndex = 0
      card.title = product.description

      const photo = this.root.createElement('img')
      photo.className = 'photo'
      photo.alt = product.name
      photo.loading = 'lazy'
      photo.src = productImage(product)

      const name = this.root.createElement('div')
      name.className = 'name'
      name.textContent = product.name
      const price = this.root.createElement('div')
      price.className = 'price'
      price.textContent = euros(product.price)
      const dims = this.root.createElement('div')
      dims.className = 'dims'
      dims.textContent = `${Math.round(product.width * 100)} × ${Math.round(product.depth * 100)} cm`

      card.append(photo, name, price, dims)
      card.addEventListener('click', () =>
        this.activate(card, { type: 'furniture', item: product }),
      )
      container.append(card)
    }
  }

  // ── Tarjetas simples (aperturas y luces) ─────────────────────────────────

  private simpleEntries(): SimpleEntry[] {
    if (this.activeTab === 'openings') {
      return [
        { placement: { type: 'opening', kind: 'door' }, name: 'Puerta', emoji: '🚪', detail: '90×200 cm' },
        { placement: { type: 'opening', kind: 'window' }, name: 'Ventana', emoji: '🪟', detail: '120×110 cm' },
      ]
    }
    return [
      { placement: { type: 'light', kind: 'ceiling' }, name: 'Plafón de techo', emoji: '💡', detail: '59 €' },
      { placement: { type: 'light', kind: 'wall' }, name: 'Aplique', emoji: '🔆', detail: '39 €' },
      { placement: { type: 'light', kind: 'floor' }, name: 'Lámpara de pie', emoji: '🕯️', detail: '79 €' },
    ]
  }

  private renderSimpleCards(container: HTMLElement): void {
    for (const entry of this.simpleEntries()) {
      const card = this.root.createElement('button')
      card.className = 'card'
      const swatch = this.root.createElement('div')
      swatch.className = 'swatch'
      swatch.textContent = entry.emoji
      const name = this.root.createElement('div')
      name.className = 'name'
      name.textContent = entry.name
      const detail = this.root.createElement('div')
      detail.className = 'dims'
      detail.textContent = entry.detail
      card.append(swatch, name, detail)
      card.addEventListener('click', () => this.activate(card, entry.placement))
      container.append(card)
    }
  }

  private activate(card: HTMLElement, placement: Placement): void {
    this.clearActive()
    card.classList.add('active')
    this.activeCard = card
    this.onPick(placement)
  }
}
