import type { DesignerRoomState } from '../../app/designer/actions'

export const ZONE_COLORS = ['#427c85', '#ad7850', '#8b75a1', '#74884f', '#bb727c', '#657fc2']

/** Resumen de los trabajos automáticos; la distribución se dibuja en la habitación. */
export class ZonePlanPanel {
  constructor(private readonly root: HTMLElement) {}

  render(state: DesignerRoomState): void {
    this.root.replaceChildren()
    this.root.hidden = !state.room || !state.zones?.length
    if (this.root.hidden) return
    const doc = this.root.ownerDocument
    const heading = doc.createElement('h3')
    heading.textContent = 'Diseño por zonas'
    const list = doc.createElement('ul')
    for (const [index, zone] of state.zones!.entries()) {
      const row = doc.createElement('li')
      row.style.setProperty('--zone-color', ZONE_COLORS[index % ZONE_COLORS.length]!)
      const name = doc.createElement('strong')
      name.textContent = zone.name
      const status = doc.createElement('span')
      const result = state.zoneResults?.[zone.id]
      status.textContent = result?.status === 'furnishing' ? 'Amueblando…'
        : result?.status === 'review' ? 'Revisar' : result?.status === 'ready' ? 'Procesada' : 'Planificada'
      row.append(name, status)
      if (result?.status === 'review') {
        const detail = doc.createElement('p')
        detail.textContent = result.reply
        row.append(detail)
      }
      list.append(row)
    }
    this.root.append(heading, list)
  }
}
