import type { FurnitureCatalog } from '../../app/catalog/FurnitureCatalog'
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
    else this.renderSimpleCards(container)
  }

  // ── Tarjetas de producto (muebles) ───────────────────────────────────────

  private renderProductCards(container: HTMLElement): void {
    for (const product of this.catalog.items()) {
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
