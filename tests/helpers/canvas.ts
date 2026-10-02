import { vi } from 'vitest'

/** Canvas determinista para verificar la interacción sin depender de un GPU. */
export function mockCanvas(): void {
  const methods = ['clearRect', 'setTransform', 'beginPath', 'moveTo', 'lineTo', 'stroke',
    'closePath', 'fill', 'fillRect', 'arc', 'fillText', 'save', 'restore', 'translate', 'rotate', 'setLineDash']
  const context = { ...Object.fromEntries(methods.map(name => [name, vi.fn()])), measureText: () => ({ width: 40 }) }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
}
