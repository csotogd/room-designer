import type { LightKind } from '../../core/model/LightPoint'
import type { Project } from '../../core/model/Project'

export interface CartLine {
  id: string
  name: string
  unitPrice: number
  quantity: number
  subtotal: number
}

export const LIGHT_PRICES: Record<LightKind, number> = {
  ceiling: 59,
  wall: 39,
  floor: 79,
}

const LIGHT_NAMES: Record<LightKind, string> = {
  ceiling: 'Plafón de techo',
  wall: 'Aplique',
  floor: 'Lámpara de pie',
}

/**
 * El carrito es una proyección del proyecto: cada mueble y luz colocados son
 * una línea, agrupados por artículo. No hay estado propio que sincronizar.
 */
export function cartLines(project: Project): CartLine[] {
  const lines = new Map<string, CartLine>()

  const add = (id: string, name: string, unitPrice: number): void => {
    const line = lines.get(id) ?? { id, name, unitPrice, quantity: 0, subtotal: 0 }
    line.quantity += 1
    line.subtotal = line.quantity * line.unitPrice
    lines.set(id, line)
  }

  for (const furniture of project.furniture) {
    add(furniture.item.id, furniture.item.name, furniture.item.price)
  }
  for (const light of project.lights) {
    add(`light-${light.kind}`, LIGHT_NAMES[light.kind], LIGHT_PRICES[light.kind])
  }
  return [...lines.values()]
}

export function cartTotal(project: Project): number {
  return cartLines(project).reduce((sum, line) => sum + line.subtotal, 0)
}
