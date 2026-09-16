import type { DesignerActivity } from '../../app/designer/actions'

const actionLabels: Record<string, string> = {
  get_room: 'Consultar la habitación', search_catalog: 'Buscar muebles',
  set_room: 'Ajustar la habitación', add_opening: 'Añadir una puerta o ventana',
  clear_openings: 'Retirar puertas y ventanas', place_furniture: 'Colocar un mueble',
  move_furniture: 'Mover un mueble', replace_furniture: 'Sustituir un mueble',
  rotate_furniture: 'Girar un mueble', remove_furniture: 'Retirar un mueble',
  apply_furniture_changes: 'Aplicar varios cambios', respond_conversationally: 'Preparar una respuesta',
  set_zones: 'Distribuir las zonas', furnish_zones: 'Amueblar las zonas',
}

/** Resúmenes públicos del proveedor y registro completo de las herramientas. */
export class AgentActivityPanel {
  readonly element: HTMLElement
  private readonly status: HTMLElement
  private readonly entries: HTMLElement
  private readonly summary: HTMLElement
  private readonly progress: HTMLElement

  constructor(private readonly root: Document) {
    this.element = root.createElement('div')
    this.element.className = 'chat-bubble assistant agent-activity'
    this.element.id = 'chat-thinking'
    this.status = root.createElement('span')
    this.status.className = 'activity-status'
    this.status.setAttribute('role', 'status')
    this.status.hidden = true
    const details = root.createElement('details')
    this.summary = root.createElement('summary')
    this.summary.textContent = 'Pensando…'
    this.summary.title = 'Ver pensamiento'
    const note = root.createElement('p')
    note.className = 'activity-note'
    note.textContent = 'Resúmenes de razonamiento disponibles del proveedor y actividad de las herramientas.'
    this.progress = root.createElement('p')
    this.progress.className = 'activity-note'
    this.progress.hidden = true
    this.entries = root.createElement('div')
    details.append(this.summary, note, this.progress, this.entries)
    this.element.append(this.status, details)
  }

  append(entry: DesignerActivity): void {
    const item = this.root.createElement('section')
    item.className = 'activity-message'
    item.dataset.agent = entry.agent
    const avatar = this.root.createElement('span')
    avatar.className = 'activity-avatar'
    avatar.textContent = entry.agent.slice(0, 1)
    avatar.setAttribute('aria-hidden', 'true')
    const body = this.root.createElement('div')
    body.className = 'activity-message-body'
    const title = this.root.createElement('strong')
    title.className = 'activity-agent'
    title.textContent = entry.agent
    const label = this.root.createElement('span')
    label.className = 'activity-kind'
    label.textContent = entry.kind === 'thinking' ? 'Resumen de razonamiento'
      : entry.kind === 'tool_call' ? 'Acción solicitada' : 'Resultado de la acción'
    body.append(title, label)
    if (entry.kind === 'thinking') {
      const content = this.root.createElement('div')
      content.className = 'activity-text'
      content.textContent = entry.text ?? ''
      body.append(content)
    } else {
      const action = this.root.createElement('p')
      action.className = 'activity-text'
      action.textContent = actionLabels[entry.tool ?? ''] ?? entry.tool ?? 'Herramienta'
      const details = this.root.createElement('details')
      details.className = 'activity-data'
      const summary = this.root.createElement('summary')
      summary.textContent = 'Ver detalles de la acción'
      const content = this.root.createElement('pre')
      content.textContent = JSON.stringify(entry.data, null, 2)
      details.append(summary, content)
      body.append(action, details)
    }
    item.append(avatar, body)
    this.entries.append(item)
  }

  updateStatus(text: string): void {
    this.progress.hidden = false
    this.progress.textContent = text
  }

  finish(status: string, activity?: readonly DesignerActivity[]): void {
    if (activity) {
      this.entries.replaceChildren()
      activity.forEach((entry) => this.append(entry))
    }
    this.progress.hidden = true
    this.status.hidden = false
    this.status.textContent = status
    this.summary.textContent = 'Ver pensamiento'
    this.element.removeAttribute('id')
  }
}
