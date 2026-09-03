import type { FurnitureCatalog } from '../../app/catalog/FurnitureCatalog'
import { SearchClient, rankLocally } from '../../app/search/SearchClient'
import type { FloorFinish, FloorMaterial, WallFinish, WallMaterial } from '../../core/model/Finishes'
import { productImage } from '../view3d/thumbnails'
import type { Placement } from '../view3d/View3D'

const euros = (value: number): string =>
  value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

interface SimpleEntry {
  placement: Placement
  name: string
  icon: string
  detail: string
}

/** Iconos de línea (SVG estáticos de la casa, sin datos externos). */
const ICONS = {
  door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21 V4.5 A1.5 1.5 0 0 1 7.5 3 h9 A1.5 1.5 0 0 1 18 4.5 V21"/><circle cx="15" cy="12.5" r="1.1" fill="currentColor" stroke="none"/><line x1="3.5" y1="21" x2="20.5" y2="21"/></svg>',
  window: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="4" y="4.5" width="16" height="15" rx="1.5"/><line x1="12" y1="4.5" x2="12" y2="19.5"/><line x1="4" y1="12" x2="20" y2="12"/></svg>',
  ceiling: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="7"/><path d="M6 12 a6 6 0 0 1 12 0 Z"/><line x1="12" y1="15.5" x2="12" y2="17.5"/><line x1="8.5" y1="15" x2="7.5" y2="16.8"/><line x1="15.5" y1="15" x2="16.5" y2="16.8"/></svg>',
  sconce: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="3" x2="5" y2="21"/><path d="M5 12 h5"/><path d="M10 9 h7 l-2 6 h-3 Z"/><line x1="13.5" y1="18" x2="13.5" y2="19.5"/></svg>',
  floorlamp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 h8 l-1.5 6 h-5 Z"/><line x1="12" y1="9" x2="12" y2="19"/><path d="M8 21 a4 2 0 0 1 8 0 Z"/></svg>',
} as const

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
  private query = ''
  private ranking: Map<string, number> | null = null
  private searchTimer = 0
  private searchSeq = 0

  constructor(
    private readonly root: Document,
    private readonly catalog: FurnitureCatalog,
    private readonly onPick: (placement: Placement) => void,
    private readonly finishes: FinishControls,
    private readonly search: SearchClient = new SearchClient(),
  ) {
    for (const button of root.querySelectorAll<HTMLButtonElement>('#catalog-tabs button')) {
      button.addEventListener('click', () => this.setTab(button.dataset.tab!))
    }
    this.bindSearch()
    this.renderCards()
  }

  private setTab(tab: string): void {
    this.activeTab = tab
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('#catalog-tabs button')) {
      b.classList.toggle('active', b.dataset.tab === tab)
    }
    this.renderCards()
  }

  // ── Búsqueda ─────────────────────────────────────────────────────────────

  private bindSearch(): void {
    const input = this.root.querySelector<HTMLInputElement>('#catalog-search-input')
    if (!input) return
    input.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer)
      this.searchTimer = window.setTimeout(() => void this.runSearch(input.value), 200)
    })
  }

  private async runSearch(raw: string): Promise<void> {
    const query = raw.trim()
    const seq = ++this.searchSeq
    this.query = query
    if (!query) {
      this.ranking = null
      this.renderCards()
      return
    }
    // La búsqueda es de muebles: al teclear saltamos a esa pestaña.
    if (this.activeTab !== 'furniture') this.setTab('furniture')
    const remote = await this.search.rank(query)
    if (seq !== this.searchSeq) return // llegó tarde: hay una consulta más nueva
    this.ranking = remote ?? rankLocally(query, this.catalog.items())
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
    let products = this.catalog.items().filter((p) => p.origin)
    if (this.query && this.ranking) {
      const ranking = this.ranking
      // Orden estable: los más relevantes arriba; sin score, al final tal cual.
      products = [...products].sort(
        (a, b) => (ranking.get(b.id) ?? -Infinity) - (ranking.get(a.id) ?? -Infinity),
      )
    }
    if (products.length === 0) {
      const empty = this.root.createElement('div')
      empty.className = 'catalog-empty'
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
        { placement: { type: 'opening', kind: 'door' }, name: 'Puerta', icon: ICONS.door, detail: '90×200 cm' },
        { placement: { type: 'opening', kind: 'window' }, name: 'Ventana', icon: ICONS.window, detail: '120×110 cm' },
      ]
    }
    return [
      { placement: { type: 'light', kind: 'ceiling' }, name: 'Plafón de techo', icon: ICONS.ceiling, detail: '59 €' },
      { placement: { type: 'light', kind: 'wall' }, name: 'Aplique', icon: ICONS.sconce, detail: '39 €' },
      { placement: { type: 'light', kind: 'floor' }, name: 'Lámpara de pie', icon: ICONS.floorlamp, detail: '79 €' },
    ]
  }

  private renderSimpleCards(container: HTMLElement): void {
    for (const entry of this.simpleEntries()) {
      const card = this.root.createElement('button')
      card.className = 'card'
      const swatch = this.root.createElement('div')
      swatch.className = 'swatch'
      swatch.innerHTML = entry.icon
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
