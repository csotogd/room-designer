// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { View2D } from '../../src/ui/view2d/View2D'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Point2D } from '../../src/core/geometry/Point2D'

test('draws zone overlays in plan coordinates and clears them with the project', () => {
  const canvas = document.createElement('canvas')
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
  const context = Object.fromEntries(['clearRect', 'setTransform', 'beginPath', 'moveTo', 'lineTo', 'stroke',
    'closePath', 'fill', 'save', 'restore', 'fillRect', 'strokeRect', 'fillText', 'setLineDash'].map(name => [name, vi.fn()]))
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  const view = new View2D(canvas, new Project(FloorPlan.rectangle(5, 4)))
  view.setZones([{ id: 'study', name: 'Estudio', x: 0, z: 0, w: 2, d: 4 }])
  const [x, y] = view.toScreen(new Point2D(0, 0))
  expect(context.fillRect).toHaveBeenCalledWith(x, y, 160, 320)
  expect(context.fillText).toHaveBeenCalledWith('Estudio', x + 8, y + 18)
  context.fillText!.mockClear()
  view.setProject(new Project(FloorPlan.rectangle(6, 4)))
  expect(context.fillText).not.toHaveBeenCalled()
})
