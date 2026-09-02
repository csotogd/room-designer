import type { FurnitureCatalog } from '../../app/catalog/FurnitureCatalog'
import type { Placement } from '../view3d/View3D'

const FURNITURE_EMOJI: Record<string, string> = {
  sofa: '🛋️',
  chair: '🪑',
  bed: '🛏️',
  wardrobe: '🚪',
  shelf: '📚',
  vase: '🏺',
  plant: '🪴',
  tv: '📺',
}

interface Entry {
  placement: Placement
  name: string
  swatch: { emoji?: string; color: string }
  dims: string
}

/**
 * Panel lateral de catálogo: pestañas + tarjetas. Elegir una tarjeta entra
 * en modo colocación (fantasma en la escena); colocar o Esc lo desactiva.
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

  private entries(): Entry[] {
    if (this.activeTab === 'furniture') {
      return this.catalog.items().map((item) => ({
        placement: { type: 'furniture', item },
        name: item.name,
        swatch: { emoji: FURNITURE_EMOJI[item.id], color: item.color + '33' },
        dims: `${Math.round(item.width * 100)}×${Math.round(item.depth * 100)} cm`,
      }))
    }
    if (this.activeTab === 'openings') {
      return [
        {
          placement: { type: 'opening', kind: 'door' },
          name: 'Puerta',
          swatch: { emoji: '🚪', color: '#b0896833' },
          dims: '90×200 cm',
        },
        {
          placement: { type: 'opening', kind: 'window' },
          name: 'Ventana',
          swatch: { emoji: '🪟', color: '#5a8bb033' },
          dims: '120×110 cm',
        },
      ]
    }
    return [
      {
        placement: { type: 'light', kind: 'ceiling' },
        name: 'Plafón de techo',
        swatch: { emoji: '💡', color: '#ffdb0033' },
        dims: 'en el techo',
      },
      {
        placement: { type: 'light', kind: 'wall' },
        name: 'Aplique',
        swatch: { emoji: '🔆', color: '#ffdb0033' },
        dims: 'en la pared',
      },
      {
        placement: { type: 'light', kind: 'floor' },
        name: 'Lámpara de pie',
        swatch: { emoji: '🕯️', color: '#ffdb0033' },
        dims: 'alto 150 cm',
      },
    ]
  }

  private renderCards(): void {
    const container = this.root.querySelector<HTMLElement>('#catalog-cards')!
    container.innerHTML = ''
    this.activeCard = null
    for (const entry of this.entries()) {
      const card = this.root.createElement('button')
      card.className = 'card'

      const swatch = this.root.createElement('div')
      swatch.className = 'swatch'
      swatch.style.background = entry.swatch.color
      swatch.textContent = entry.swatch.emoji ?? ''
      const name = this.root.createElement('div')
      name.className = 'name'
      name.textContent = entry.name
      const dims = this.root.createElement('div')
      dims.className = 'dims'
      dims.textContent = entry.dims
      card.append(swatch, name, dims)

      card.addEventListener('click', () => {
        this.clearActive()
        card.classList.add('active')
        this.activeCard = card
        this.onPick(entry.placement)
      })
      container.append(card)
    }
  }
}
