import { cartLines, cartTotal } from '../../app/cart/Cart'
import type { Project } from '../../core/model/Project'

const euros = (value: number): string =>
  value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

/**
 * Carrito de la compra: resumen en la barra superior y panel desplegable.
 * No guarda estado: se deriva del proyecto en cada cambio.
 */
export class CartPanel {
  private project: Project

  constructor(
    private readonly root: Document,
    project: Project,
  ) {
    this.project = project
    this.root.querySelector('#cart-button')!.addEventListener('click', () => {
      const panel = this.panel()
      panel.hidden = !panel.hidden
      if (!panel.hidden) this.renderPanel()
    })
    this.refresh()
  }

  setProject(project: Project): void {
    this.project = project
    this.refresh()
  }

  refresh(): void {
    const lines = cartLines(this.project)
    const count = lines.reduce((sum, line) => sum + line.quantity, 0)
    this.root.querySelector('#cart-summary')!.textContent =
      `${count} · ${euros(cartTotal(this.project))}`
    if (!this.panel().hidden) this.renderPanel()
  }

  private panel(): HTMLElement {
    return this.root.querySelector<HTMLElement>('#cart-panel')!
  }

  private renderPanel(): void {
    const panel = this.panel()
    panel.innerHTML = ''
    const title = this.root.createElement('h3')
    title.textContent = 'Tu carrito'
    panel.append(title)

    const lines = cartLines(this.project)
    if (lines.length === 0) {
      const empty = this.root.createElement('div')
      empty.className = 'cart-empty'
      empty.textContent = 'Todavía no has añadido nada: coloca muebles o luces en la escena.'
      panel.append(empty)
      return
    }

    for (const line of lines) {
      const row = this.root.createElement('div')
      row.className = 'cart-line'
      const name = this.root.createElement('span')
      name.textContent = line.name
      const qty = this.root.createElement('span')
      qty.className = 'qty'
      qty.textContent = `×${line.quantity}`
      const price = this.root.createElement('span')
      price.textContent = euros(line.subtotal)
      row.append(name, qty, price)
      panel.append(row)
    }

    const total = this.root.createElement('div')
    total.className = 'cart-total'
    const label = this.root.createElement('span')
    label.textContent = 'Total'
    const amount = this.root.createElement('span')
    amount.textContent = euros(cartTotal(this.project))
    total.append(label, amount)
    panel.append(total)
  }
}
